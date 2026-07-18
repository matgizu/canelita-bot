import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { apiRouter } from "./api/routes";
import { testRouter } from "./api/test";
import { webhookRouter } from "./api/webhook";
import { config } from "./config";
import { prisma } from "./db";
import { notifyOwner } from "./owner";
import { sweepHotLeads } from "./bot/hotRecovery";
import { sendStatsToOwner } from "./reports/statsReport";
import { runDropiSync } from "./dropi/tracker";

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

// Serve uploaded product media from Railway Volume (or local UPLOADS_DIR)
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/app/uploads";
fs.mkdirSync(path.join(UPLOADS_DIR, "products"), { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d" }));

app.use("/webhook", webhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);
app.use("/api/test", testRouter);

app.get("/catalog", (_req, res) => res.sendFile(path.resolve(__dirname, "..", "public", "catalog.html")));
app.get("/audit",   (_req, res) => res.sendFile(path.resolve(__dirname, "..", "public", "audit.html")));
app.get("/pnl",     (_req, res) => res.sendFile(path.resolve(__dirname, "..", "public", "pnl.html")));

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

    const totalRevenue = orderAgg._sum.total ?? 0;
    const dateStr = yesterdayColMidnight.toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const responseRate = newConvs > 0 ? ((replied / newConvs) * 100).toFixed(1) : "0.0";
    const closeRate    = newConvs > 0 ? ((closedConvs / newConvs) * 100).toFixed(1) : "0.0";

    // Revenue line: use actual orders sum if available, else show closed convs only
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

// Reporte semanal completo (mes / 14d / 7d / 3d + anuncios): lunes 8am COL.
function scheduleWeeklyStats(): void {
  // Lunes 8am COL = lunes 13:00 UTC (UTC-5, sin DST).
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(13, 0, 0, 0);
  while (next.getUTCDay() !== 1 || next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(13, 0, 0, 0);
  }
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    sendStatsToOwner().catch(() => {});
    setInterval(() => sendStatsToOwner().catch(() => {}), 7 * 24 * 60 * 60 * 1000).unref();
  }, delay).unref();
}

// Marcador de versión — sube el cierre con: recuperación de leads calientes,
// cierre asuntivo en CONFIRM_ORDER y split A/B 80/20. Cutover: 2026-06-19.
export const RELEASE = "2026-06-19-closerate-v1";

app.listen(config.port, () => {
  console.log(`[freskabox-bot] listening on :${config.port} | release: ${RELEASE}`);
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

// Recupera leads calientes estancados a un paso del cierre (cada 10 min).
sweepHotLeads().catch(() => {});
setInterval(() => sweepHotLeads().catch(() => {}), 10 * 60 * 1000).unref();

scheduleDailyReport();
scheduleWeeklyStats();

// Barrido de estados de guía en Dropi → notifica a los clientes cómo va su
// pedido. Se activa con DROPI_TRACKING_ENABLED=true. El primer barrido solo
// siembra (no notifica); las transiciones posteriores disparan los mensajes.
if (config.dropi.enabled) {
  const everyMs = Math.max(5, config.dropi.pollMinutes) * 60 * 1000;
  // Espera 30s tras arrancar para no competir con el resto del boot.
  setTimeout(() => {
    runDropiSync().catch((e) => console.error("[dropi.sync]", e.message));
    setInterval(() => runDropiSync().catch((e) => console.error("[dropi.sync]", e.message)), everyMs).unref();
  }, 30_000).unref();
  console.log(`[dropi.sync] activo — cada ${config.dropi.pollMinutes} min (envío: ${config.dropi.sendEnabled ? "ON" : "DRY-RUN"})`);
}
