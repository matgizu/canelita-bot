import { config } from "../config";
import { sendImageUrl, sendText } from "../whatsapp/client";
import { Session, REMARKETING_DELAYS, REMARKETING_MESSAGES, State } from "./flow";
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

// Llamado justo después de enviar el greeting.
// Si la persona no responde en 2h, manda testimonios + mensaje.
export function scheduleGreetingRemarketing(waId: string) {
  clearTimers(waId);
  const timer = setTimeout(
    () => sendTestimonialsRemarketing(waId),
    REMARKETING_DELAYS.testimonials,
  );
  trackers.set(waId, { timers: [timer] });
}

// Llamado después de que Claude responde (estados INTEREST en adelante).
export function scheduleRemarketing(session: Session) {
  clearTimers(session.waId);
  const timers: NodeJS.Timeout[] = [];

  const staged = stagedFor(session.state);
  if (staged) {
    timers.push(
      setTimeout(() => sendRemarketing(session.waId, staged.text, "stage"), staged.delay),
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

async function sendTestimonialsRemarketing(waId: string) {
  const imgs = config.greeting.imageUrls;

  // Enviar cada imagen con 1s de pausa entre ellas
  for (const url of imgs) {
    await sendImageUrl(waId, url);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const text = REMARKETING_MESSAGES.testimonials2h;
  await sendText(waId, text);

  const label = `[remarketing: testimonios x${imgs.length}]\n${text}`;

  events.emitDashboard({
    type: "message", waId, direction: "outbound",
    body: label, messageType: "remarketing:testimonials", at: Date.now(),
  });

  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (conv) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "outbound",
          type: "remarketing:testimonials",
          body: label,
        },
      });
    }
  } catch (e: any) {
    console.error("[remarketing.testimonials]", e.message);
  }
}

async function sendRemarketing(waId: string, text: string, kind: string) {
  await sendText(waId, text);
  events.emitDashboard({
    type: "message", waId, direction: "outbound",
    body: text, messageType: `remarketing:${kind}`, at: Date.now(),
  });
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (conv) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "outbound",
          type: `remarketing:${kind}`,
          body: text,
        },
      });
    }
  } catch (e: any) {
    console.error("[remarketing.persist]", e.message);
  }
}
