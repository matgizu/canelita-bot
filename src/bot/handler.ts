import { askClaude } from "../claude/client";
import { events } from "../events";
import { prisma } from "../db";
import { getOrLoadSession, getSession, setAutomation } from "../sessions";
import { notify, notifyPhoto } from "../telegram";
import { notifyOwner, markOwnerWindowOpen } from "../owner";
import { handleOwnerMessage } from "./ownerHandler";
import { findCombo, formatCOP } from "../products";
import { getConfig } from "../botConfig";
import {
  getMediaUrl,
  markAsRead,
  reactionFor,
  sendImageUrl,
  sendInParts,
  sendReaction,
  sendText,
  sendVideoUrl,
} from "../whatsapp/client";
import { config } from "../config";
import { transcribeAudio } from "../whatsapp/transcribe";
import { sanitizeOutput } from "./blocklist";
import {
  CartItem,
  HARDCODED_GREETING,
  HARDCODED_GREETING_JSON,
  Session,
  State,
  isValidTransition,
  pushHistory,
  buildDynamicGreeting,
  buildDynamicGreetingB,
} from "./flow";
import { enqueueInbound } from "./messageQueue";
import {
  HARD_OBJECTION_THRESHOLD,
  buildObjectionResponse,
  detectObjection,
  detectPhotoRequest,
  detectVideoRequest,
} from "./objections";
import type { SessionFields } from "./parser";
import { cancelRemarketing, scheduleFullSequence } from "./remarketing";
import { detectSpecialCase, TELEGRAM_TEMPLATES } from "./specialCases";

export interface InboundEvent {
  waId: string;
  customerName?: string;
  type: "text" | "audio" | "image" | "other";
  text?: string;
  mediaId?: string;
  whatsappMsgId?: string;
  referral?: {
    sourceId?: string;
    headline?: string;
    ctwaClid?: string;
  };
}

export async function handleInbound(ev: InboundEvent): Promise<void> {
  if (ev.waId === config.owner.waNumber) {
    await handleOwnerMessage(ev.text ?? "");
    return;
  }
  const session = await getOrLoadSession(ev.waId);
  session.lastInboundAt = Date.now();
  if (ev.customerName && !session.customerName) {
    session.customerName = ev.customerName;
  }

  if (ev.referral && !session.adSource) {
    session.adSource   = ev.referral.sourceId;
    session.adHeadline = ev.referral.headline;
    session.ctwaClid   = ev.referral.ctwaClid;
  }

  if (ev.whatsappMsgId) {
    markAsRead(ev.whatsappMsgId).catch(() => {});
  }

  // Stickers, reactions, location pins, etc. — nothing actionable, skip silently.
  if (ev.type === "other" && !ev.text && !ev.mediaId) return;

  let text = ev.text ?? "";
  let hasImage = false;
  let imageMediaId: string | undefined;

  if (ev.type === "audio" && ev.mediaId) {
    const transcript = await transcribeAudio(ev.mediaId);
    if (transcript) {
      text = transcript;
    } else {
      // No transcription available — log, notify dashboard, and ask customer to type
      await persistInbound(session, ev, "[audio - sin transcripción]");
      cancelRemarketing(ev.waId);
      events.emitDashboard({
        type: "message",
        waId: ev.waId,
        direction: "inbound",
        body: "[audio]",
        messageType: ev.type,
        at: Date.now(),
      });
      if (session.automationEnabled) {
        await sendText(
          ev.waId,
          "¡Hola! No pude escuchar bien el audio 🎤 ¿Me escribes tu pregunta? Así te respondo enseguida 💛",
        );
        await persistOutbound(session, "¡Hola! No pude escuchar bien el audio 🎤 ¿Me escribes tu pregunta? Así te respondo enseguida 💛", session.state);
        events.emitDashboard({
          type: "message",
          waId: ev.waId,
          direction: "outbound",
          body: "¡Hola! No pude escuchar bien el audio 🎤 ¿Me escribes tu pregunta? Así te respondo enseguida 💛",
          messageType: "text",
          at: Date.now(),
        });
      }
      return;
    }
  }

  if (ev.type === "image") {
    hasImage = true;
    imageMediaId = ev.mediaId;
  }

  await persistInbound(session, ev, text);

  cancelRemarketing(ev.waId);
  events.emitDashboard({
    type: "message",
    waId: ev.waId,
    direction: "inbound",
    body: text || (hasImage ? "[imagen]" : "[audio]"),
    messageType: ev.type,
    mediaUrl: hasImage ? imageMediaId : undefined,
    at: Date.now(),
  });

  if (!session.automationEnabled) return;

  enqueueInbound(
    ev.waId,
    text,
    (combined, hi, mid) => processCombined(session, combined, hi, mid),
    { hasImage, imageMediaId },
  );
}

async function processCombined(
  session: Session,
  combined: string,
  hasImage: boolean,
  imageMediaId?: string,
): Promise<void> {
  if (!session.automationEnabled) return;

  const dynCfg = await getConfig();
  if (dynCfg.botPaused) return;

  if (session.history.length === 0 && session.state === "GREETING") {
    const imgs = config.greeting.imageUrls;
    if (session.strategy === "B") {
      // Estrategia B: envía TODAS las fotos + video antes del texto
      for (const url of imgs) {
        await sendImageUrl(session.waId, url);
        await new Promise((r) => setTimeout(r, 600));
      }
      if (config.product.videoUrl) {
        await sendVideoUrl(session.waId, config.product.videoUrl);
        await new Promise((r) => setTimeout(r, 800));
      }
      const greeting = buildDynamicGreetingB(dynCfg.pack3Price, dynCfg.pack6Price);
      const greetingJson = JSON.stringify({ message: greeting, state: "GREETING", cartUpdate: null });
      await replyHardcoded(session, greeting, greetingJson);
    } else {
      // Estrategia A: 1 foto aleatoria
      if (imgs.length > 0) {
        const url = imgs[Math.floor(Math.random() * imgs.length)];
        await sendImageUrl(session.waId, url);
      }
      const greeting = buildDynamicGreeting(dynCfg.pack3Price, dynCfg.pack6Price);
      const greetingJson = JSON.stringify({ message: greeting, state: "GREETING", cartUpdate: null });
      await replyHardcoded(session, greeting, greetingJson);
    }
    pushHistory(session, "user", combined);
    transitionTo(session, "INTEREST");
    scheduleFullSequence(session);
    return;
  }

  const reactionEmoji = reactionFor(combined);

  const special = detectSpecialCase({
    text: combined,
    hasImage,
    state: session.state,
  });

  if (special) {
    if (special.type === "testimonials_request") {
      for (const url of config.greeting.imageUrls) {
        await sendImageUrl(session.waId, url);
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    await replyText(session, special.response, session.state);

    if (special.type === "payment_proof") {
      let mediaUrl: string | null = null;
      if (imageMediaId) mediaUrl = await getMediaUrl(imageMediaId);
      const tg = TELEGRAM_TEMPLATES.paymentProof(session.waId, session.fullName ?? session.customerName);
      mediaUrl ? notifyPhoto(tg, mediaUrl) : notify(tg);
      transitionTo(session, "CLOSED");
    }

    if (special.type === "wholesaler") {
      session.automationEnabled = false;
      setAutomation(session.waId, false);
      events.emitDashboard({
        type: "automation_toggle",
        waId: session.waId,
        enabled: false,
        at: Date.now(),
      });
      prisma.conversation
        .update({ where: { waId: session.waId }, data: { automationEnabled: false } })
        .catch((e: any) => console.error("[wholesaler.persist]", e.message));
      notify(TELEGRAM_TEMPLATES.wholesaler(session.waId, session.customerName));
    }

    if (special.type === "not_interested") {
      session.automationEnabled = false;
      setAutomation(session.waId, false);
      events.emitDashboard({
        type: "automation_toggle",
        waId: session.waId,
        enabled: false,
        at: Date.now(),
      });
      cancelRemarketing(session.waId);
      // Do NOT transition to CLOSED — that state is reserved for completed purchases.
      // Just disable the bot and leave the conversation at its current funnel state.
      prisma.conversation
        .update({ where: { waId: session.waId }, data: { automationEnabled: false } })
        .catch((e: any) => console.error("[not_interested.persist]", e.message));
      notify(TELEGRAM_TEMPLATES.notInterested(session.waId, session.customerName));
    }

    if (special.type === "come_back_later" && special.reminder) {
      const dueAt = new Date(Date.now() + special.reminder.daysFromNow * 24 * 60 * 60 * 1000);
      prisma.reminder
        .create({ data: { waId: session.waId, note: special.reminder.note, dueAt } })
        .catch((e: any) => console.error("[reminder.comeBack]", e.message));
    }

    return;
  }

  pushHistory(session, "user", combined);

  const objection = detectObjection(combined);
  let claudeText = "";
  let nextState: State = session.state;
  let cartUpdate: CartItem[] | null = null;
  let detectedObjectionType: string | null = null;

  if (objection && session.state !== "GREETING") {
    session.objectionCount += 1;
    detectedObjectionType = objection.type;
    claudeText = buildObjectionResponse(objection);
    nextState = "OBJECTION_HANDLING";

    if (session.objectionCount >= HARD_OBJECTION_THRESHOLD) {
      notify(TELEGRAM_TEMPLATES.hardObjection(session.waId, session.objectionCount));
    }
  } else {
    const reply = await askClaude(session, combined);
    claudeText = reply.message;
    let proposedState = isValidTransition(session.state, reply.state)
      ? reply.state
      : session.state;
    // CLOSED is only valid for real completed purchases — block it if the customer
    // hasn't provided at minimum a name and address.
    if (proposedState === "CLOSED" && !hasMinimumOrderData(session)) {
      proposedState = session.state;
    }
    nextState = proposedState;
    cartUpdate = reply.cartUpdate;
    if (reply.fields) applyFields(session, reply.fields);
    if (reply.reminder) {
      const dueAt = new Date(Date.now() + reply.reminder.daysFromNow * 24 * 60 * 60 * 1000);
      prisma.reminder
        .create({ data: { waId: session.waId, note: reply.reminder.note, dueAt } })
        .catch((e: any) => console.error("[reminder.create]", e.message));
    }
  }

  const sanitized = sanitizeOutput(claudeText);
  if (!sanitized) {
    console.warn("[handler] empty sanitized output");
    return;
  }

  if (cartUpdate) session.cart = cartUpdate;

  if (reactionEmoji) {
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: (await ensureConversation(session)).id, direction: "inbound" },
      orderBy: { createdAt: "desc" },
    });
    if (lastInbound?.whatsappMsgId) {
      sendReaction(session.waId, lastInbound.whatsappMsgId, reactionEmoji).catch(() => {});
    }
  }

  if (detectPhotoRequest(combined) && config.greeting.imageUrls.length > 0) {
    for (const url of config.greeting.imageUrls) {
      await sendImageUrl(session.waId, url);
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (detectVideoRequest(combined) && config.product.videoUrl) {
    await sendVideoUrl(session.waId, config.product.videoUrl);
  }

  const outboundMsgId = await sendInParts(session.waId, sanitized);
  session.lastOutboundAt = Date.now();

  pushHistory(
    session,
    "assistant",
    JSON.stringify({ message: sanitized, state: nextState, cartUpdate }),
  );

  if (nextState !== session.state) transitionTo(session, nextState);

  if (nextState === "CLOSED") {
    await persistOrderIfNeeded(session);
    cancelRemarketing(session.waId);
  } else if (nextState === "CONFIRM_ORDER" || nextState === "ADDRESS_COLLECTION" || nextState === "PAYMENT_METHOD") {
    cancelRemarketing(session.waId);
  } else {
    scheduleFullSequence(session);
  }

  await persistOutbound(session, sanitized, nextState, detectedObjectionType ?? undefined, outboundMsgId ?? undefined);

  events.emitDashboard({
    type: "message",
    waId: session.waId,
    direction: "outbound",
    body: sanitized,
    messageType: "text",
    at: Date.now(),
  });
}

function applyFields(session: Session, f: SessionFields) {
  if (f.fullName)    session.fullName    = f.fullName;
  if (f.idNumber)    session.idNumber    = f.idNumber;
  if (f.email)       session.email       = f.email;
  if (f.city)        session.city        = f.city;
  if (f.department)  session.department  = f.department;
  if (f.address)     session.address     = f.address;
  if (f.reference)   session.reference   = f.reference;
  if (f.altPhone)    session.altPhone    = f.altPhone;
}

function transitionTo(session: Session, to: State) {
  const from = session.state;
  if (from === to) return;
  session.state = to;
  events.emitDashboard({
    type: "state_change",
    waId: session.waId,
    from,
    to,
    at: Date.now(),
  });
}

async function replyHardcoded(session: Session, text: string, historyJson: string) {
  const msgId = await sendText(session.waId, text);
  pushHistory(session, "assistant", historyJson);
  await persistOutbound(session, text, session.state, undefined, msgId ?? undefined);
  session.lastOutboundAt = Date.now();
  events.emitDashboard({
    type: "message",
    waId: session.waId,
    direction: "outbound",
    body: text,
    messageType: "text",
    at: Date.now(),
  });
}

async function replyText(session: Session, text: string, state: State) {
  const sanitized = sanitizeOutput(text);
  const msgId = await sendInParts(session.waId, sanitized);
  pushHistory(
    session,
    "assistant",
    JSON.stringify({ message: sanitized, state, cartUpdate: null }),
  );
  await persistOutbound(session, sanitized, state, undefined, msgId ?? undefined);
  session.lastOutboundAt = Date.now();
  events.emitDashboard({
    type: "message",
    waId: session.waId,
    direction: "outbound",
    body: sanitized,
    messageType: "text",
    at: Date.now(),
  });
}

async function ensureConversation(session: Session) {
  return prisma.conversation.upsert({
    where: { waId: session.waId },
    create: {
      waId: session.waId,
      state: session.state,
      ...(session.strategy ? { strategy: session.strategy } as any : {}),
      automationEnabled: session.automationEnabled,
      customerName: session.customerName,
      cart: session.cart as any,
      adSource:   session.adSource,
      adHeadline: session.adHeadline,
      ctwaClid:   session.ctwaClid,
    },
    update: {
      state: session.state,
      automationEnabled: session.automationEnabled,
      customerName: session.customerName ?? undefined,
      fullName: session.fullName ?? undefined,
      idNumber: session.idNumber ?? undefined,
      email: session.email ?? undefined,
      city: session.city ?? undefined,
      department: session.department ?? undefined,
      address: session.address ?? undefined,
      reference: session.reference ?? undefined,
      altPhone: session.altPhone ?? undefined,
      adSource:   session.adSource   ?? undefined,
      adHeadline: session.adHeadline ?? undefined,
      ctwaClid:   session.ctwaClid   ?? undefined,
      cart: session.cart as any,
      lastInboundAt: new Date(session.lastInboundAt),
    },
  });
}

async function persistInbound(session: Session, ev: InboundEvent, finalText: string) {
  try {
    const conv = await ensureConversation(session);
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "inbound",
        type: ev.type,
        body: finalText || (ev.type === "image" ? "[imagen]" : ev.type === "audio" ? "[audio]" : ""),
        whatsappMsgId: ev.whatsappMsgId,
        mediaUrl: ev.mediaId ?? null,
      },
    });
  } catch (e: any) {
    console.error("[handler.persistInbound]", e.message);
  }
}

async function persistOutbound(session: Session, body: string, state: State, objectionType?: string, whatsappMsgId?: string) {
  try {
    const conv = await ensureConversation(session);
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        type: "text",
        body,
        rawState: state,
        objectionType: objectionType ?? null,
        whatsappMsgId: whatsappMsgId ?? null,
      },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        state,
        lastOutboundAt: new Date(),
        cart: session.cart as any,
      },
    });
  } catch (e: any) {
    console.error("[handler.persistOutbound]", e.message);
  }
}

// Exported for unit testing — pure decision function with no DB dependencies.
export function shouldCreateNewOrder(existing: { id: number; status: string } | null): boolean {
  if (!existing) return true;
  return existing.status === "CANCELLED";
}

export async function persistOrderIfNeeded(session: Session) {
  if (!session.cart.length) return;
  const total = await computeTotal(session);

  try {
    const conv = await ensureConversation(session);

    const existing = await prisma.order.findFirst({
      where: { conversationId: conv.id, status: { not: "CANCELLED" } },
      select: { id: true, status: true },
    });

    const orderData = {
      cart:          session.cart as any,
      total,
      paymentMethod: session.pendingOrder?.paymentMethod ?? "cod",
      fullName:      session.fullName      ?? null,
      idNumber:      session.idNumber      ?? null,
      email:         session.email         ?? null,
      address:       session.address       ?? null,
      city:          session.city          ?? null,
      department:    session.department    ?? null,
      altPhone:      session.altPhone      ?? null,
      reference:     session.reference     ?? null,
    };

    if (shouldCreateNewOrder(existing)) {
      const order = await prisma.order.create({
        data: { conversationId: conv.id, status: "PENDING", ...orderData },
        select: { id: true },
      });

      events.emitDashboard({
        type: "order_created",
        waId: session.waId,
        orderId: order.id,
        total,
        at: Date.now(),
      });

      notifyOwner(`🛒 *Nuevo pedido*\n\n${orderSummary(session, total)}`).catch(() => {});
      notify(TELEGRAM_TEMPLATES.newOrder(session.waId, orderSummary(session, total)));
    } else {
      await prisma.order.update({
        where: { id: existing!.id },
        data: orderData,
      });
    }
  } catch (e: any) {
    console.error("[handler.persistOrder]", e.message);
  }
}

async function computeTotal(session: Session): Promise<number> {
  const cfg = await getConfig();
  const prices: Record<string, number> = { pack3: cfg.pack3Price, pack6: cfg.pack6Price };
  for (const item of session.cart) {
    const base = prices[item.variant] ?? findCombo(item.variant)?.price ?? cfg.pack3Price;
    const unitPrice = session.discountOffered ? base - cfg.remarketingDiscount : base;
    return unitPrice * item.quantity;
  }
  return cfg.pack3Price;
}

function hasMinimumOrderData(session: Session): boolean {
  return (
    session.cart.length > 0 &&
    !!(session.fullName || session.customerName) &&
    !!session.address
  );
}

function orderSummary(session: Session, total: number): string {
  const items = session.cart
    .map((c) => `• ${c.variant === "pack6" ? "Pack x6 (6 cajones)" : "Pack x3 (3 cajones)"}`)
    .join("\n");
  const lines = [
    items,
    `*Total:* ${formatCOP(total)}`,
    session.fullName ? `*Nombre:* ${session.fullName}` : null,
    session.idNumber ? `*Cédula:* ${session.idNumber}` : null,
    session.city ? `*Ciudad:* ${session.city}${session.department ? ", " + session.department : ""}` : null,
    session.address ? `*Dirección:* ${session.address}` : null,
    session.reference ? `*Referencia:* ${session.reference}` : null,
    session.altPhone ? `*Cel alterno:* ${session.altPhone}` : null,
    `*Pago:* ${session.pendingOrder?.paymentMethod ?? "contraentrega"}`,
  ].filter(Boolean);
  return lines.join("\n");
}
