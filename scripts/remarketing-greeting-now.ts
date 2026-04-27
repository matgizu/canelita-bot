/**
 * One-shot: find conversations stuck in GREETING/INTEREST with no response
 * for more than 2 hours and send them the testimonials remarketing right now.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/remarketing-greeting-now.ts
 */

import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

const WHATSAPP_TOKEN        = process.env.WHATSAPP_TOKEN!;
const WHATSAPP_PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const API_VERSION           = process.env.WHATSAPP_API_VERSION ?? "v21.0";
const GREETING_IMAGE_URLS   = (process.env.GREETING_IMAGE_URLS ?? "").split(",").map(u => u.trim()).filter(Boolean);
const TWO_HOURS_MS          = 2 * 60 * 60 * 1000;

const REMARKETING_TEXT =
  `Reina, ¿pudiste ver bien la info? 💛\n\nMira los resultados que están teniendo nuestras clientas con Canelita... el bronceado queda natural y divino.\n\nRecuerda: envío GRATIS a toda Colombia y pagas solo cuando lo recibes. Sin riesgo ✨\n\n¿Te lo mandamos hoy?`;

async function send(to: string, body: object) {
  return axios.post(
    `https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_ID}/messages`,
    body,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } },
  );
}

async function sendText(waId: string, text: string) {
  await send(waId, { messaging_product: "whatsapp", to: waId, type: "text", text: { body: text } });
}

async function sendImageUrl(waId: string, url: string) {
  await send(waId, { messaging_product: "whatsapp", to: waId, type: "image", image: { link: url } });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const cutoff = new Date(Date.now() - TWO_HOURS_MS);

  const conversations = await prisma.conversation.findMany({
    where: {
      state: { in: ["GREETING", "INTEREST"] },
      lastInboundAt: { lt: cutoff },
    },
    orderBy: { lastInboundAt: "asc" },
  });

  if (conversations.length === 0) {
    console.log("No hay conversaciones elegibles.");
    return;
  }

  console.log(`\nEncontradas ${conversations.length} conversaciones elegibles:\n`);
  for (const c of conversations) {
    const hoursAgo = ((Date.now() - c.lastInboundAt.getTime()) / 3600000).toFixed(1);
    console.log(`  ${c.waId}  estado=${c.state}  última respuesta hace ${hoursAgo}h  nombre=${c.customerName ?? "-"}`);
  }

  console.log("\n¿Enviar remarketing a todas? (ctrl+c para cancelar, enter para continuar)");
  await new Promise(r => process.stdin.once("data", r));
  process.stdin.pause();

  for (const conv of conversations) {
    console.log(`\n→ Enviando a ${conv.waId} (${conv.customerName ?? "sin nombre"})...`);

    try {
      // Send each testimonial image
      for (const url of GREETING_IMAGE_URLS) {
        await sendImageUrl(conv.waId, url);
        console.log(`  ✓ imagen: ${url}`);
        await sleep(1000);
      }

      // Send persuasive text
      await sendText(conv.waId, REMARKETING_TEXT);
      console.log(`  ✓ mensaje enviado`);

      // Persist to DB
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "outbound",
          type: "remarketing:testimonials",
          body: `[remarketing: testimonios x${GREETING_IMAGE_URLS.length}]\n${REMARKETING_TEXT}`,
        },
      });
      console.log(`  ✓ persistido`);
    } catch (e: any) {
      console.error(`  ✗ error: ${e.message}`);
    }
  }

  console.log("\nListo.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
