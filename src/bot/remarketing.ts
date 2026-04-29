import { config } from "../config";
import { sendImageUrl, sendText } from "../whatsapp/client";
import { REMARKETING_MESSAGES, Session, msUntilNextDayColTime } from "./flow";
import { events } from "../events";
import { prisma } from "../db";

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

    if (remaining <= 0)           continue; // already past
    if (touch.delay > WINDOW_72H) continue; // outside Meta window

    const { type } = touch;
    timers.push(
      setTimeout(() => fireTouch(session.waId, type), remaining),
    );
  }

  if (timers.length) trackers.set(session.waId, { timers });
}

async function fireTouch(waId: string, type: string) {
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) return;
    if (conv.windowExpired) return;
    if (conv.state === "CLOSED") return;

    if (type === "t1") {
      await sendT1(waId, conv.id);
    } else {
      const msg = REMARKETING_MESSAGES[type as keyof typeof REMARKETING_MESSAGES];
      if (!msg) return;
      await sendRemarketingText(waId, conv.id, msg, type);
    }
  } catch (e: any) {
    console.error(`[remarketing.${type}]`, e.message);
  }
}

async function sendT1(waId: string, convId: number) {
  const imgs = config.greeting.imageUrls;
  for (const url of imgs) {
    await sendImageUrl(waId, url);
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
