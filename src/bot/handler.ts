import { askClaude } from "../claude/client";
import { events } from "../events";
import { prisma } from "../db";
import { getSession, setAutomation } from "../sessions";
import { notify, notifyPhoto } from "../telegram";
import { findCombo, formatCOP } from "../products";
import {
  getMediaUrl,
  markAsRead,
  reactionFor,
  sendImageUrl,
  sendInParts,
  sendReaction,
  sendText,
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
} from "./flow";
import { enqueueInbound } from "./messageQueue";
import {
  HARD_OBJECTION_THRESHOLD,
  buildObjectionResponse,
  detectObjection,
} from "./objections";
import { cancelRemarketing, scheduleGreetingRemarketing, scheduleRemarketing } from "./remarketing";
import { detectSpecialCase, TELEGRAM_TEMPLATES } from "./specialCases";

export interface InboundEvent {
  waId: string;
  customerName?: string;
  type: "text" | "audio" | "image" | "other";
  text?: string;
  mediaId?: string;
  whatsappMsgId?: string;
}

export async function handleInbound(ev: InboundEvent): Promise<void> {
  const session = getSession(ev.waId);
  session.lastInboundAt = Date.now();
  if (ev.customerName && !session.customerName) {
    session.customerName = ev.customerName;
  }

  if (ev.whatsappMsgId) {
    markAsRead(ev.whatsappMsgId).catch(() => {});
  }

  let text = ev.text ?? "";
  let hasImage = false;
  let imageMediaId: string | undefined;

  if (ev.type === "audio" && ev.mediaId) {
    const transcript = await transcribeAudio(ev.mediaId);
    if (transcript) text = transcript;
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

  if (session.history.length === 0 && session.state === "GREETING") {
    const imgs = config.greeting.imageUrls;
    if (imgs.length > 0) {
      const url = imgs[Math.floor(Math.random() * imgs.length)];
      await sendImageUrl(session.waId, url);
    }
    await replyHardcoded(session, HARDCODED_GREETING, HARDCODED_GREETING_JSON);
    pushHistory(session, "user", combined);
    transitionTo(session, "INTEREST");
    scheduleGreetingRemarketing(session.waId);
    return;
  }

  const reactionEmoji = reactionFor(combined);

  const special = detectSpecialCase({
    text: combined,
    hasImage,
    state: session.state,
  });

  if (special) {
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
      notify(TELEGRAM_TEMPLATES.wholesaler(session.waId, session.customerName));
    }
    return;
  }

  pushHistory(session, "user", combined);

  const objection = detectObjection(combined);
  let claudeText = "";
  let nextState: State = session.state;
  let cartUpdate: CartItem[] | null = null;

  if (objection && session.state !== "GREETING") {
    session.objectionCount += 1;
    claudeText = buildObjectionResponse(objection);
    nextState = "OBJECTION_HANDLING";

    if (session.objectionCount >= HARD_OBJECTION_THRESHOLD) {
      notify(TELEGRAM_TEMPLATES.hardObjection(session.waId, session.objectionCount));
    }
  } else {
    const reply = await askClaude(session, combined);
    claudeText = reply.message;
    nextState = isValidTransition(session.state, reply.state)
      ? reply.state
      : session.state;
    cartUpdate = reply.cartUpdate;
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

  await sendInParts(session.waId, sanitized);
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
  } else {
    scheduleRemarketing(session);
  }

  await persistOutbound(session, sanitized, nextState);

  events.emitDashboard({
    type: "message",
    waId: session.waId,
    direction: "outbound",
    body: sanitized,
    messageType: "text",
    at: Date.now(),
  });
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
  await sendText(session.waId, text);
  pushHistory(session, "assistant", historyJson);
  await persistOutbound(session, text, session.state);
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
  await sendInParts(session.waId, sanitized);
  pushHistory(
    session,
    "assistant",
    JSON.stringify({ message: sanitized, state, cartUpdate: null }),
  );
  await persistOutbound(session, sanitized, state);
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
      automationEnabled: session.automationEnabled,
      customerName: session.customerName,
      cart: session.cart as any,
    },
    update: {
      state: session.state,
      automationEnabled: session.automationEnabled,
      customerName: session.customerName ?? undefined,
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

async function persistOutbound(session: Session, body: string, state: State) {
  try {
    const conv = await ensureConversation(session);
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        type: "text",
        body,
        rawState: state,
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

async function persistOrderIfNeeded(session: Session) {
  if (!session.cart.length) return;
  const total = computeTotal(session.cart);
  try {
    const conv = await ensureConversation(session);
    const order = await prisma.order.create({
      data: {
        conversationId: conv.id,
        cart: session.cart as any,
        total,
        paymentMethod: session.pendingOrder?.paymentMethod ?? "cod",
        status: "PENDING",
        fullName: session.fullName,
        idNumber: session.idNumber,
        address: session.address,
        city: session.city,
        department: session.department,
        altPhone: session.altPhone,
        reference: session.reference,
      },
    });
    events.emitDashboard({
      type: "order_created",
      waId: session.waId,
      orderId: order.id,
      total,
      at: Date.now(),
    });
    notify(
      TELEGRAM_TEMPLATES.newOrder(
        session.waId,
        orderSummary(session, total),
      ),
    );
  } catch (e: any) {
    console.error("[handler.persistOrder]", e.message);
  }
}

function computeTotal(cart: CartItem[]): number {
  const totalUnits = cart.reduce((s, c) => s + c.quantity, 0);
  if (totalUnits >= 1 && totalUnits <= 3) {
    const combo = findCombo(totalUnits as 1 | 2 | 3);
    if (combo) return combo.price;
  }
  const unit = findCombo(1)!.price;
  return unit * totalUnits;
}

function orderSummary(session: Session, total: number): string {
  const items = session.cart
    .map((c) => `• ${c.quantity}x Canelita ${c.variant === "natural" ? "Natural" : "Intenso"}`)
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
