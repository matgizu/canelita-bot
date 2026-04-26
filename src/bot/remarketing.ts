import { sendInParts } from "../whatsapp/client";
import { Session, REMARKETING_DELAYS, REMARKETING_MESSAGES, State } from "./flow";
import { sanitizeOutput } from "./blocklist";
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

export function scheduleRemarketing(session: Session) {
  clearTimers(session.waId);
  const timers: NodeJS.Timeout[] = [];

  const stagedMessage = stagedFor(session.state);
  if (stagedMessage) {
    timers.push(
      setTimeout(() => sendRemarketing(session.waId, stagedMessage.text, "stage"), stagedMessage.delay),
    );
  }

  timers.push(
    setTimeout(
      () => sendRemarketing(session.waId, REMARKETING_MESSAGES.recovery24h, "recovery"),
      REMARKETING_DELAYS.recovery,
    ),
  );

  trackers.set(session.waId, { timers });
}

function stagedFor(state: State): { text: string; delay: number } | null {
  switch (state) {
    case "CONFIRM_ORDER":
      return { text: REMARKETING_MESSAGES.confirmOrder30min, delay: REMARKETING_DELAYS.confirmOrder };
    case "ADDRESS_COLLECTION":
      return { text: REMARKETING_MESSAGES.addressCollection1h, delay: REMARKETING_DELAYS.addressCollection };
    case "PAYMENT_METHOD":
      return { text: REMARKETING_MESSAGES.paymentMethod2h, delay: REMARKETING_DELAYS.paymentMethod };
    default:
      return null;
  }
}

async function sendRemarketing(waId: string, text: string, kind: string) {
  const clean = sanitizeOutput(text);
  await sendInParts(waId, clean);
  events.emitDashboard({
    type: "message",
    waId,
    direction: "outbound",
    body: clean,
    messageType: `remarketing:${kind}`,
    at: Date.now(),
  });
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (conv) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "outbound",
          type: `remarketing:${kind}`,
          body: clean,
        },
      });
    }
  } catch (e: any) {
    console.error("[remarketing.persist]", e.message);
  }
}
