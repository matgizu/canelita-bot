import { askClaude } from "../claude/client";
import { events } from "../events";
import { prisma } from "../db";
import { getOrLoadSession, getSession, setAutomation, isAutomationPaused } from "../sessions";
import { notify, notifyPhoto } from "../telegram";
import { notifyOwner, notifyOwnerError, markOwnerWindowOpen } from "../owner";
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
import { sendConversionEvent } from "../meta/capi";
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
  type: "text" | "audio" | "image" | "video" | "document" | "other";
  text?: string;
  mediaId?: string;
  filename?: string;
  whatsappMsgId?: string;
  // WhatsApp Business Account ID (entry.id from the webhook) — used for CTWA CAPI.
  wabaId?: string;
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

  // Cualquier mensaje entrante del cliente REABRE la ventana de 24h. Limpiamos
  // el flag persistido para que el panel vuelva a habilitar el envío; sin esto
  // quedaba marcado como expirado para siempre y bloqueaba el cuadro de texto.
  prisma.conversation
    .updateMany({ where: { waId: ev.waId }, data: { windowExpired: false } })
    .catch(() => {});
  if (ev.customerName && !session.customerName) {
    session.customerName = ev.customerName;
  }

  // Keep the WABA id fresh on the session so conversion events can be attributed.
  if (ev.wabaId) session.wabaId = ev.wabaId;

  if (ev.referral) {
    const ref = ev.referral;
    const firstTouch = !session.adSource;

    // adSource/adHeadline = PRIMER toque: el origen de descubrimiento no se
    // sobrescribe aunque vuelva por otro anuncio.
    if (firstTouch) {
      session.adSource   = ref.sourceId;
      session.adHeadline = ref.headline;
    }

    // ctwaClid = ÚLTIMO toque: el CAPI debe atribuir la conversión al anuncio
    // (p.ej. remarketing) que realmente la cerró, no al de descubrimiento.
    if (ref.ctwaClid) session.ctwaClid = ref.ctwaClid;

    // Historial completo de anuncios por los que ha entrado (para el panel).
    // No duplica si vuelve por el mismo anuncio consecutivamente.
    session.adHistory = session.adHistory ?? [];
    const last = session.adHistory[session.adHistory.length - 1];
    if (!last || last.sourceId !== ref.sourceId || last.ctwaClid !== ref.ctwaClid) {
      session.adHistory.push({
        sourceId: ref.sourceId,
        headline: ref.headline,
        ctwaClid: ref.ctwaClid,
        at: Date.now(),
      });
    }

    // Señal top-of-funnel: sólo en el primer contacto desde un anuncio CTWA.
    if (firstTouch && ref.ctwaClid) {
      sendConversionEvent({
        eventName: "Contact",
        ctwaClid: ref.ctwaClid,
        wabaId: session.wabaId ?? config.whatsapp.wabaId,
        eventId: `contact_${session.waId}`,
      }).catch(() => {});
    }
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
      if (session.automationEnabled && !(await isAutomationPaused(session.waId))) {
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

  // Friendly placeholder shown when the customer sends media without a caption.
  const placeholder =
    ev.type === "image"    ? "[imagen]" :
    ev.type === "video"    ? "[video]" :
    ev.type === "document" ? `[documento${ev.filename ? ": " + ev.filename : ""}]` :
    ev.type === "audio"    ? "[audio]" : "";

  await persistInbound(session, ev, text || placeholder);

  cancelRemarketing(ev.waId);
  events.emitDashboard({
    type: "message",
    waId: ev.waId,
    direction: "inbound",
    body: text || placeholder,
    messageType: ev.type,
    mediaUrl: ev.mediaId ?? undefined,
    filename: ev.filename ?? undefined,
    at: Date.now(),
  } as any);

  if (!session.automationEnabled) return;

  // Stickers/reactions/location without any content: nothing actionable.
  if (ev.type === "other" && !text.trim() && !placeholder) return;

  // Image without caption outside of PAYMENT_METHOD → fixed fridge upsell.
  // We can't see the image, but we assume it's their fridge and push the x6.
  if (ev.type === "image" && !text.trim() && session.state !== "PAYMENT_METHOD") {
    if (!(await isAutomationPaused(ev.waId))) {
      const msg = "En tu nevera pueden caber 6 organizadores aproximadamente 🌿 Ya me dices cuántos te mando";
      await sendText(ev.waId, msg);
      await persistOutbound(session, msg, session.state);
      events.emitDashboard({
        type: "message", waId: ev.waId, direction: "outbound",
        body: msg, messageType: "text", at: Date.now(),
      });
    }
    return;
  }

  // For all other media without caption (video, doc, or image in PAYMENT_METHOD):
  // pass the placeholder to Claude so it can respond contextually.
  const textForClaude = text.trim() || placeholder;
  if (!textForClaude) return;

  enqueueInbound(
    ev.waId,
    textForClaude,
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
  // Authoritative re-check against the DB: the captured `session` can be a
  // stale/orphaned object that still reads enabled after a dashboard pause.
  // This is the final gate before we actually send, so it must not be skipped.
  if (await isAutomationPaused(session.waId)) return;

  const dynCfg = await getConfig();
  if (dynCfg.botPaused) return;

  if (session.history.length === 0 && session.state === "GREETING") {
    const imgs = config.greeting.imageUrls;
    if (session.strategy === "B") {
      // Estrategia B: envía TODAS las fotos + video antes del texto
      for (const url of imgs) {
        await sendImageUrl(session.waId, url);
        await new Promise((r) => setTimeout(r, 600));
        await persistMediaOutbound(session, url, "image");
      }
      if (config.product.videoUrl) {
        await sendVideoUrl(session.waId, config.product.videoUrl);
        await new Promise((r) => setTimeout(r, 800));
        await persistMediaOutbound(session, config.product.videoUrl, "video");
      }
      const greeting = buildDynamicGreetingB(dynCfg.pack3Price, dynCfg.pack6Price);
      const greetingJson = JSON.stringify({ message: greeting, state: "GREETING", cartUpdate: null });
      await replyHardcoded(session, greeting, greetingJson);
    } else {
      // Estrategia A: 1 foto aleatoria
      if (imgs.length > 0) {
        const url = imgs[Math.floor(Math.random() * imgs.length)];
        await sendImageUrl(session.waId, url);
        await persistMediaOutbound(session, url, "image");
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

  // Defensa final: si después de combinar no queda texto real, no seguimos.
  // Un combined vacío metería un turno vacío al historial y rompería la
  // llamada a Claude (400) para toda la conversación.
  if (!combined.trim()) return;

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
  let aiError = false;

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
    aiError = reply.error === true;
    claudeText = reply.message;
    // Aplica PRIMERO los datos que llegaron en este turno: si el cliente mandó
    // nombre + dirección junto con el cierre, deben estar en la sesión ANTES de
    // validar el cierre. Si no, hasMinimumOrderData corría con la dirección aún
    // vacía y bloqueaba la venta, dejándola en ADDRESS_COLLECTION (cierre manual).
    if (reply.fields) applyFields(session, reply.fields);
    if (reply.cartUpdate) session.cart = reply.cartUpdate;
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
    if (reply.reminder) {
      const dueAt = new Date(Date.now() + reply.reminder.daysFromNow * 24 * 60 * 60 * 1000);
      prisma.reminder
        .create({ data: { waId: session.waId, note: reply.reminder.note, dueAt } })
        .catch((e: any) => console.error("[reminder.create]", e.message));
    }
  }

  // Error de IA: no enviamos nada fuera de marca al cliente. Avisamos al dueño
  // (con throttle) para que entre a contestar manualmente y no se pierda el lead.
  if (aiError) {
    // Quitamos el turno del cliente que acabamos de agregar: sin respuesta del
    // asistente quedarían dos turnos "user" seguidos y la próxima llamada a la
    // API fallaría. Así el historial se mantiene consistente para el reintento.
    if (session.history[session.history.length - 1]?.role === "user") {
      session.history.pop();
    }
    notifyAiError(session.waId, session.customerName);
    return;
  }

  const sanitized = sanitizeOutput(claudeText);
  if (!sanitized) {
    console.warn("[handler] empty sanitized output");
    return;
  }

  // (session.cart ya se actualizó arriba, antes de validar el cierre)

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
    await persistMediaOutbound(session, config.product.videoUrl, "video");
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
    // Sella la fecha/hora del cierre la PRIMERA vez (where closedAt: null).
    prisma.conversation
      .updateMany({ where: { waId: session.waId, closedAt: null }, data: { closedAt: new Date() } })
      .catch((e: any) => console.error("[closedAt]", e.message));
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
      adHistory:  (session.adHistory ?? []) as any,
      ...(session.wabaId ? { wabaId: session.wabaId } as any : {}),
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
      adHistory:  (session.adHistory ?? []) as any,
      ...(session.wabaId ? { wabaId: session.wabaId } as any : {}),
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

      // Tell Meta this CTWA lead converted, so the ad can attribute & optimize
      // for real purchases. Deduped per order; safe no-op without a ctwa_clid.
      if (session.ctwaClid) {
        sendConversionEvent({
          eventName: "Purchase",
          ctwaClid: session.ctwaClid,
          wabaId: session.wabaId ?? config.whatsapp.wabaId,
          eventId: `purchase_${order.id}`,
          value: total,
          currency: "COP",
        }).catch(() => {});
      }
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

// Throttle de avisos de error de IA al dueño: máximo uno cada 5 minutos para
// no inundar Telegram si la API se cae afectando muchas conversaciones.
let lastAiErrorNotifyAt = 0;
function notifyAiError(waId: string, customerName?: string) {
  const now = Date.now();
  if (now - lastAiErrorNotifyAt < 5 * 60 * 1000) return;
  lastAiErrorNotifyAt = now;
  const who = customerName ? `${customerName} (+${waId})` : `+${waId}`;
  const body = `⚠️ *Error de IA*\n\nEl bot no pudo responderle a ${who} y se quedó callado para no mandar algo roto.\n\nEntra a contestarle manualmente desde el panel.`;
  notify(body); // Telegram (dashboard)
  notifyOwner(body).catch(() => {}); // WhatsApp directo al dueño
}

async function persistMediaOutbound(session: Session, url: string, type: "image" | "video") {
  try {
    const conv = await ensureConversation(session);
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        type,
        body: url,
        rawState: session.state,
      },
    });
    events.emitDashboard({
      type: "message",
      waId: session.waId,
      direction: "outbound",
      body: url,
      messageType: type,
      at: Date.now(),
    });
  } catch (e: any) {
    console.error("[handler.persistMediaOutbound]", e.message);
  }
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
