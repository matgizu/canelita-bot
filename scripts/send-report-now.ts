import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();
const OWNER = process.env.OWNER_WA_NUMBER ?? "+573124743435";
const TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

async function sendWA(text: string) {
  await axios.post(
    `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`,
    { messaging_product: "whatsapp", to: OWNER, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } },
  );
}

async function main() {
  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setUTCHours(5, 0, 0, 0);
  if (todayMidnight > now) todayMidnight.setUTCDate(todayMidnight.getUTCDate() - 1);
  const yesterdayMidnight = new Date(todayMidnight);
  yesterdayMidnight.setUTCDate(yesterdayMidnight.getUTCDate() - 1);

  const [orderAgg, newConvs, closedConvs, objRows] = await Promise.all([
    prisma.order.aggregate({
      where: { createdAt: { gte: yesterdayMidnight, lt: todayMidnight }, status: { not: "CANCELLED" } },
      _count: { id: true }, _sum: { total: true },
    }),
    prisma.conversation.count({ where: { createdAt: { gte: yesterdayMidnight, lt: todayMidnight } } }),
    prisma.conversation.count({ where: { state: "CLOSED", updatedAt: { gte: yesterdayMidnight, lt: todayMidnight } } }),
    prisma.$queryRaw<Array<{ objectionType: string; count: bigint }>>`
      SELECT "objectionType", COUNT(*) AS count FROM "Message"
      WHERE "objectionType" IS NOT NULL AND "createdAt" >= ${yesterdayMidnight} AND "createdAt" < ${todayMidnight}
      GROUP BY "objectionType" ORDER BY count DESC LIMIT 5
    `,
  ]);

  const repliedRows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS count FROM (
      SELECT m."conversationId" FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m.direction = 'inbound' AND c."createdAt" >= ${yesterdayMidnight} AND c."createdAt" < ${todayMidnight}
      GROUP BY m."conversationId" HAVING COUNT(*) >= 2
    ) sub
  `;
  const replied = Number(repliedRows[0]?.count ?? 0);
  const totalRevenue = orderAgg._sum.total ?? 0;
  const dateStr = yesterdayMidnight.toLocaleDateString("es-CO", {
    timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long",
  });
  const responseRate = newConvs > 0 ? ((replied / newConvs) * 100).toFixed(1) : "0.0";
  const closeRate = newConvs > 0 ? ((closedConvs / newConvs) * 100).toFixed(1) : "0.0";
  const revenueStr = totalRevenue > 0
    ? `$${Number(totalRevenue).toLocaleString("es-CO")} COP`
    : "por confirmar";
  const objLines = objRows.length
    ? objRows.map((r) => `• ${r.objectionType} (${r.count} veces)`).join("\n")
    : "• Ninguna registrada";

  const msg = [
    `📊 *Reporte Canelita — ${dateStr}*`,
    ``,
    `💰 Ventas cerradas: *${closedConvs}* | ${revenueStr}`,
    `💬 Conversaciones nuevas: *${newConvs}*`,
    `📈 Tasa de cierre: *${closeRate}%*`,
    `📨 Tasa de respuesta: *${responseRate}%*`,
    ``,
    `🚧 *Objeciones del día:*`,
    objLines,
  ].join("\n");

  console.log("Enviando:\n", msg);
  await sendWA(msg);
  console.log("✓ Enviado a", OWNER);
}

main().catch(console.error).finally(() => prisma.$disconnect());
