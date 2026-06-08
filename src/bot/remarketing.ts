import { config } from "../config";
import { sendText, sendVideoUrl } from "../whatsapp/client";
import { REMARKETING_MESSAGES, Session, msUntilNextDayColTime } from "./flow";
import { events } from "../events";
import { prisma } from "../db";
import { patchSessionIfLoaded } from "../sessions";

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
    { delay: 2  * 60 * 60 * 1000,              type: "t1" },
    { delay: 10 * 60 * 60 * 1000,              type: "t2" },
    { delay: msUntilNextDayColTime(start, 8),  type: "t3" },
    { delay: msUntilNextDayColTime(start, 15), type: "t4" },
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
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) return;
    if (conv.windowExpired) return;
    if (LATE_FUNNEL_STATES.has(conv.state)) return;
    // Also skip if the customer has already shared their data (name + address or city)
    if (conv.fullName && (conv.address || conv.city)) return;

    if (type === "t1") {
      await sendT1(waId, conv.id);
    } else {
      const msg = REMARKETING_MESSAGES[type as keyof typeof REMARKETING_MESSAGES];
      if (!msg) return;
      await sendRemarketingText(waId, conv.id, msg, type);
    }

    // t3 offers a $10.000 discount — remember it so the rest of the
    // conversation (and the final order total) honors that price.
    if (type === "t3" && !conv.discountOffered) {
      await prisma.conversation.update({ where: { waId }, data: { discountOffered: true } });
      patchSessionIfLoaded(waId, { discountOffered: true });
    }
  } catch (e: any) {
    console.error(`[remarketing.${type}]`, e.message);
  }
}

async function sendT1(waId: string, convId: number) {
  if (config.product.videoUrl) {
    await sendVideoUrl(waId, config.product.videoUrl);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await sendRemarketingText(waId, convId, REMARKETING_MESSAGES.t1, "t1");
}

async function sendRemarketingText(waId: string, convId: number, text: string, type: string) {
  await sendText(waId, text);

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
    },
  });
}
