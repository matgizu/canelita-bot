import "dotenv/config";
import path from "node:path";
import express from "express";
import { apiRouter } from "./api/routes";
import { testRouter } from "./api/test";
import { webhookRouter } from "./api/webhook";
import { config } from "./config";
import { prisma } from "./db";
import { notifyOwner } from "./owner";

const app = express();

app.use(express.static(path.resolve(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    } else if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

app.use("/webhook", webhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);
app.use("/api/test", testRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

async function sendDailyReport(): Promise<void> {
  try {
    // Report covers YESTERDAY in COL time (UTC-5)
    // Today's COL midnight = 05:00 UTC
    const now = new Date();
    const todayColMidnight = new Date(now);
    todayColMidnight.setUTCHours(5, 0, 0, 0);
    if (todayColMidnight > now) todayColMidnight.setUTCDate(todayColMidnight.getUTCDate() - 1);
    // Yesterday's COL midnight
    const yesterdayColMidnight = new Date(todayColMidnight);
    yesterdayColMidnight.setUTCDate(yesterdayColMidnight.getUTCDate() - 1);

    const [orderAgg, newConvs, closedConvs, objRows] = await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: yesterdayColMidnight, lt: todayColMidnight }, status: { not: "CANCELLED" } },
        _count: { id: true },
        _sum:   { total: true },
      }),
      prisma.conversation.count({ where: { createdAt: { gte: yesterdayColMidnight, lt: todayColMidnight } } }),
      prisma.conversation.count({ where: { state: "CLOSED", updatedAt: { gte: yesterdayColMidnight, lt: todayColMidnight } } }),
      prisma.$queryRaw<Array<{ objectionType: string; count: bigint }>>`
        SELECT "objectionType", COUNT(*) AS count
        FROM "Message"
        WHERE "objectionType" IS NOT NULL
          AND "createdAt" >= ${yesterdayColMidnight}
          AND "createdAt" < ${todayColMidnight}
        GROUP BY "objectionType"
        ORDER BY count DESC
        LIMIT 5
      `,
    ]);

    // Conversations created today that received ≥2 inbound messages
    const repliedRows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM (
        SELECT m."conversationId"
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'inbound'
          AND c."createdAt" >= ${yesterdayColMidnight}
          AND c."createdAt" < ${todayColMidnight}
        GROUP BY m."conversationId"
        HAVING COUNT(*) >= 2
      ) sub
    `;
    const replied = Number(repliedRows[0]?.count ?? 0);

    const orderCount   = orderAgg._count.id ?? 0;
    const totalRevenue = orderAgg._sum.total ?? 0;
    const dateStr = yesterdayColMidnight.toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const responseRate = newConvs > 0 ? ((replied / newConvs) * 100).toFixed(1) : "0.0";
    const closeRate    = newConvs > 0 ? ((closedConvs / newConvs) * 100).toFixed(1) : "0.0";

    const objLines = objRows.length
      ? objRows.map((r) => `• ${r.objectionType} (${r.count} veces)`).join("\n")
      : "• Ninguna registrada";

    const msg = [
      `📊 *Reporte Canelita — ${dateStr}*`,
      ``,
      `💰 Ventas: *${orderCount} pedidos* | $${totalRevenue.toLocaleString("es-CO")} COP`,
      `💬 Conversaciones nuevas: *${newConvs}*`,
      `📈 Tasa de cierre: *${closeRate}%*`,
      `📨 Tasa de respuesta: *${responseRate}%*`,
      ``,
      `🚧 *Objeciones del día:*`,
      objLines,
    ].join("\n");

    await notifyOwner(msg);
  } catch (e: any) {
    console.error("[daily.report]", e.message);
  }
}

function scheduleDailyReport(): void {
  // Send at 8am COL = 13:00 UTC
  const now = Date.now();
  const next = new Date(now);
  next.setUTCHours(13, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);

  const delay = next.getTime() - now;
  setTimeout(() => {
    sendDailyReport().catch(() => {});
    setInterval(() => sendDailyReport().catch(() => {}), 24 * 60 * 60 * 1000).unref();
  }, delay).unref();
}

app.listen(config.port, () => {
  console.log(`[canelita-bot] listening on :${config.port}`);
});

// Check for due reminders every 10 minutes
setInterval(async () => {
  try {
    const due = await prisma.reminder.findMany({
      where: { sent: false, dueAt: { lte: new Date() } },
    });
    for (const r of due) {
      // Mark sent BEFORE notifying to prevent duplicate notifications on slow ticks
      await prisma.reminder.update({ where: { id: r.id }, data: { sent: true } });
      const dateStr = new Date(r.dueAt).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        dateStyle: "short",
        timeStyle: "short",
      });
      await notifyOwner(
        `🔔 *Recordatorio pendiente*\n\n${r.note}\n\n👤 +${r.waId}\n📅 Venció: ${dateStr}`,
      );
    }
  } catch (e: any) {
    console.error("[reminder.checker]", e.message);
  }
}, 10 * 60 * 1000).unref();

scheduleDailyReport();
