import { config } from "../config";
import { sendText } from "../whatsapp/client";
import { Session, msUntilNextDayColTime, buildRemarketingMsg } from "./flow";
import { events } from "../events";
import { prisma } from "../db";
import { getConfig } from "../botConfig";

interface Tracker {
  timers: NodeJS.Timeout[];
}

const trackers = new Map<string, Tracker>();

function clearTimers(waId: string) {
  const t = trackers.get(waId);
  if (t) {
    for (const x of t.timers) clearTimeout(x);
    trackers.delete(waId);
  }
}

export function cancelRemarketing(waId: string) {
  clearTimers(waId);
}

// Single entry point: schedule all 4 touches from session.createdAt.
// Safe to call repeatedly — recalculates and replaces existing timers.
export function scheduleFullSequence(session: Session) {
  clearTimers(session.waId);

  const start = session.createdAt;
  const WINDOW_72H = 72 * 60 * 60 * 1000;

  const touches: Array<{ delay: number; type: string }> = [
    { delay: msUntilNextDayColTime(start, 8), type: "t3" },
  ];

  const timers: NodeJS.Timeout[] = [];

  for (const touch of touches) {
    const absoluteFire = start + touch.delay;
    const remaining    = absoluteFire - Date.now();

    if (remaining <= 0)                       continue; // already past
    if (absoluteFire > start + WINDOW_72H)    continue; // outside Meta 72h window

    const { type } = touch;
    timers.push(
      setTimeout(() => fireTouch(session.waId, type), remaining),
    );
  }

  if (timers.length) trackers.set(session.waId, { timers });
}

const LATE_FUNNEL_STATES = new Set(["CONFIRM_ORDER", "ADDRESS_COLLECTION", "PAYMENT_METHOD", "CLOSED"]);

async function fireTouch(waId: string, type: string) {
  try {
    const cfg = await getConfig();
    if (!cfg.remarketingEnabled) return;

    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) return;
    if (conv.windowExpired) return;
    if (LATE_FUNNEL_STATES.has(conv.state)) return;
    // Also skip if the customer has already shared their data (name + address or city)
    if (conv.fullName && (conv.address || conv.city)) return;

    const msg = type === "t3" ? buildRemarketingMsg(cfg.pack3Price) : null;
    if (!msg) return;
    await sendRemarketingText(waId, conv.id, msg, type);
    // El remarketing ya NO ofrece descuento: no se activa discountOffered, así
    // que el precio del pedido y el contexto de la IA quedan al precio normal.
  } catch (e: any) {
    console.error(`[remarketing.${type}]`, e.message);
  }
}

async function sendRemarketingText(waId: string, convId: number, text: string, type: string) {
  const msgId = await sendText(waId, text);

  events.emitDashboard({
    type: "message",
    waId,
    direction: "outbound",
    body: text,
    messageType: `remarketing:${type}`,
    at: Date.now(),
  });

  await prisma.message.create({
    data: {
      conversationId: convId,
      direction: "outbound",
      type: `remarketing:${type}`,
      body: text,
      whatsappMsgId: msgId ?? null,
    },
  });
}
