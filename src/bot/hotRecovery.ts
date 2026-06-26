import { sendText } from "../whatsapp/client";
import { prisma } from "../db";
import { events } from "../events";
import { getConfig } from "../botConfig";

// Estados "calientes": el cliente mostró intención real de compra pero no cerró.
// Son los leads de mayor retorno — un solo empujón los recupera.
const HOT_STATES = ["CONFIRM_ORDER", "ADDRESS_COLLECTION", "QUANTITY", "OBJECTION_HANDLING"];

// Ventana: el cliente lleva callado >2h (genuinamente estancado) pero <23h
// (todavía dentro de la ventana de 24h de WhatsApp para mensajes de texto libre).
const QUIET_MIN_MS = 2 * 60 * 60 * 1000;
const QUIET_MAX_MS = 23 * 60 * 60 * 1000;

const HOT_TOUCH_TYPE = "remarketing:hot";

function recoveryMessage(state: string): string {
  switch (state) {
    case "ADDRESS_COLLECTION":
      return "¡Hola! Te quedaste a un paso 😊 Solo me faltan tus datos de envío para despacharlo. Pásamelos y te lo dejo en camino hoy mismo — envío gratis y pagas cuando lo recibes.";
    case "CONFIRM_ORDER":
      return "¡Hola! Te dejé el pedido casi listo. Envío gratis a toda Colombia 🇨🇴 y pagas al recibirlo, sin riesgo. ¿Lo confirmamos?";
    case "OBJECTION_HANDLING":
      return "¡Hola! ¿Quedó alguna duda dándote vueltas? Recuerda que pagas solo cuando lo tienes en las manos — si no te convence, no pagas. ¿Te lo mando?";
    default: // QUANTITY
      return "¡Hola! ¿Seguimos con tu pedido? Envío gratis y pagas cuando lo recibes 🇨🇴 ¿Cuál pack te dejo en camino?";
  }
}

async function sendHotTouch(waId: string, convId: number, text: string) {
  const msgId = await sendText(waId, text);

  events.emitDashboard({
    type: "message",
    waId,
    direction: "outbound",
    body: text,
    messageType: HOT_TOUCH_TYPE,
    at: Date.now(),
  });

  await prisma.message.create({
    data: {
      conversationId: convId,
      direction: "outbound",
      type: HOT_TOUCH_TYPE,
      body: text,
      whatsappMsgId: msgId ?? null,
    },
  });
}

// Barrido: recupera leads calientes que se quedaron callados a un paso del cierre.
// Un solo toque por conversación (no insiste). Pensado para correr cada ~10 min.
export async function sweepHotLeads(): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.remarketingEnabled) return;

    const now = Date.now();
    const candidates = await prisma.conversation.findMany({
      where: {
        state: { in: HOT_STATES },
        automationEnabled: true,
        windowExpired: false,
        lastInboundAt: {
          gte: new Date(now - QUIET_MAX_MS),
          lte: new Date(now - QUIET_MIN_MS),
        },
      },
      select: { id: true, waId: true, state: true },
    });

    for (const conv of candidates) {
      // Un único toque de recuperación por conversación.
      const already = await prisma.message.count({
        where: { conversationId: conv.id, type: HOT_TOUCH_TYPE },
      });
      if (already > 0) continue;

      await sendHotTouch(conv.waId, conv.id, recoveryMessage(conv.state));
    }
  } catch (e: any) {
    console.error("[hotRecovery.sweep]", e.message);
  }
}
