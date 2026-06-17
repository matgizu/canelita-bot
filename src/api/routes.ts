import axios from "axios";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { events } from "../events";
import { config } from "../config";
import { getSession, setAutomation } from "../sessions";
import { cancelRemarketing } from "../bot/remarketing";
import { persistOrderIfNeeded } from "../bot/handler";
import { ownerWindowStatus } from "../owner";
import { deleteMessage, mimeToMediaType, sendInParts, sendMedia, uploadMedia } from "../whatsapp/client";
import { sanitizeOutput } from "../bot/blocklist";
import { submitToMeta, syncFromMeta, sendTemplate } from "../whatsapp/templates";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB
});

export const apiRouter = Router();

apiRouter.get("/owner-status", (_req, res) => {
  res.json({ windowOpen: ownerWindowStatus() });
});

apiRouter.get("/metrics", async (_req, res) => {
  try {
    const [
      total,
      closed,
      repliedRows,
      todayRows,
    ] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { state: "CLOSED" } }),
      // Conversations where the customer sent ≥2 inbound messages (replied after greeting)
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM (
          SELECT "conversationId"
          FROM "Message"
          WHERE direction = 'inbound'
          GROUP BY "conversationId"
          HAVING COUNT(*) >= 2
        ) sub
      `,
      // Conversations created today
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM "Conversation"
        WHERE "createdAt" >= CURRENT_DATE
      `,
    ]);

    const replied = Number(repliedRows[0]?.count ?? 0);
    const today   = Number(todayRows[0]?.count ?? 0);

    res.json({
      total,
      closed,
      replied,
      today,
      responseRate: total > 0 ? replied / total : 0,
      closeRate:    total > 0 ? closed / total   : 0,
    });
  } catch (e: any) {
    console.error("[metrics]", e.message);
    res.status(500).json({ error: "metrics_error" });
  }
});

apiRouter.get("/remarketing-stats", async (_req, res) => {
  try {
    const types = ["t1", "t2", "t3", "t4"] as const;

    // Fire all 12 queries in parallel (3 per touch type × 4 types)
    const queries = types.map((t) => {
      const msgType = `remarketing:${t}`;
      return Promise.all([
        prisma.message.count({ where: { type: msgType, direction: "outbound" } }),
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT m2."conversationId") AS count
          FROM "Message" m1
          JOIN "Message" m2
            ON m2."conversationId" = m1."conversationId"
            AND m2.direction = 'inbound'
            AND m2."createdAt" > m1."createdAt"
          WHERE m1.type = ${msgType}
            AND m1.direction = 'outbound'
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT c.id) AS count
          FROM "Conversation" c
          JOIN "Message" m
            ON m."conversationId" = c.id
            AND m.type = ${msgType}
            AND m.direction = 'outbound'
          WHERE c.state = 'CLOSED'
        `,
      ] as const);
    });

    const resolved = await Promise.all(queries);
    const result = Object.fromEntries(
      types.map((t, i) => [
        t,
        {
          sent:      resolved[i][0],
          replied:   Number(resolved[i][1][0]?.count ?? 0),
          converted: Number(resolved[i][2][0]?.count ?? 0),
        },
      ]),
    ) as Record<(typeof types)[number], { sent: number; replied: number; converted: number }>;

    const totalSent      = Object.values(result).reduce((s, r) => s + r.sent, 0);
    const totalReplied   = Object.values(result).reduce((s, r) => s + r.replied, 0);
    const totalConverted = Object.values(result).reduce((s, r) => s + r.converted, 0);

    res.json({
      ...result,
      overall: {
        sent:           totalSent,
        replied:        totalReplied,
        converted:      totalConverted,
        replyRate:      totalSent > 0 ? totalReplied   / totalSent : 0,
        conversionRate: totalSent > 0 ? totalConverted / totalSent : 0,
      },
    });
  } catch (e: any) {
    console.error("[remarketing-stats]", e.message);
    res.status(500).json({ error: "stats_error" });
  }
});

apiRouter.get("/reminders", async (_req, res) => {
  try {
    const reminders = await prisma.reminder.findMany({
      where: { sent: false },
      orderBy: { dueAt: "asc" },
      take: 50,
    });
    res.json(reminders);
  } catch (e: any) {
    console.error("[reminders.fetch]", e.message);
    res.status(500).json({ error: "fetch_failed" });
  }
});

apiRouter.patch("/reminders/:id/dismiss", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    await prisma.reminder.update({ where: { id }, data: { sent: true } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

/* ── Templates ─────────────────────────────────────────────────────────── */

apiRouter.get("/templates", async (_req, res) => {
  await syncFromMeta().catch(() => {});
  const templates = await prisma.template.findMany({ orderBy: { createdAt: "desc" } });
  res.json(templates);
});

apiRouter.post("/templates", async (req, res) => {
  const { name, category = "MARKETING", language = "es", body } = req.body ?? {};
  if (!name || !body) { res.status(400).json({ error: "name and body required" }); return; }

  const safeName = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);

  try {
    let metaId: string | undefined;
    let status = "DRAFT";

    if (config.whatsapp.wabaId) {
      const metaRes = await submitToMeta(safeName, category, language, body);
      metaId = metaRes.id;
      status = metaRes.status ?? "PENDING";
    }

    const template = await prisma.template.upsert({
      where: { name: safeName },
      create: { name: safeName, category, language, body, metaId, status },
      update: { category, language, body, metaId: metaId ?? undefined, status },
    });
    res.json(template);
  } catch (e: any) {
    const msg = e.response?.data?.error?.message ?? e.message;
    res.status(400).json({ error: msg });
  }
});

apiRouter.delete("/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  await prisma.template.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
});

apiRouter.post("/conversations/:waId/send-template", async (req, res) => {
  const { templateName, variables = [] } = req.body ?? {};
  if (!templateName) { res.status(400).json({ error: "templateName required" }); return; }
  const waId = req.params.waId;

  const template = await prisma.template.findUnique({ where: { name: templateName } });
  if (!template) { res.status(404).json({ error: "template_not_found" }); return; }
  if (template.status !== "APPROVED") { res.status(400).json({ error: "template_not_approved" }); return; }

  const msgId = await sendTemplate(waId, templateName, template.language, variables);
  if (!msgId) { res.status(502).json({ error: "send_failed" }); return; }

  // Reset window expired flag
  await prisma.conversation
    .updateMany({ where: { waId }, data: { windowExpired: false } })
    .catch(() => {});

  const session = getSession(waId);
  session.lastOutboundAt = Date.now();

  try {
    const conv = await prisma.conversation.upsert({
      where: { waId },
      create: { waId },
      update: { lastOutboundAt: new Date(), windowExpired: false },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        type: "template",
        body: `[plantilla: ${templateName}]\n${template.body}`,
      },
    });
  } catch {}

  events.emitDashboard({
    type: "message", waId, direction: "outbound",
    body: `[plantilla: ${templateName}]\n${template.body}`,
    messageType: "template", at: Date.now(),
  });

  res.json({ ok: true, msgId });
});

apiRouter.get("/conversations", async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastInboundAt: "desc" },
  });
  res.json(conversations);
});

apiRouter.get("/conversations/stream/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  const off = events.onDashboard((e) => {
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  });

  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(ping);
    off();
  });
});

apiRouter.get("/conversations/:waId", async (req, res) => {
  const conv = await prisma.conversation.findUnique({
    where: { waId: req.params.waId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 500 },
      orders: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!conv) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(conv);
});

apiRouter.patch("/conversations/:waId/labels", async (req, res) => {
  const labels: string[] = (req.body?.labels ?? [])
    .filter((l: unknown) => typeof l === "string" && l.trim())
    .map((l: string) => l.trim().slice(0, 40))
    .slice(0, 15);

  await prisma.conversation
    .upsert({
      where: { waId: req.params.waId },
      create: { waId: req.params.waId, labels },
      update: { labels },
    })
    .catch((e) => console.error("[labels]", e.message));

  events.emitDashboard({
    type: "labels_update",
    waId: req.params.waId,
    labels,
    at: Date.now(),
  });
  res.json({ ok: true, labels });
});

apiRouter.get("/orders", async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        conversation: {
          select: { waId: true, customerName: true, phone: true, email: true },
        },
      },
    });
    res.json(orders);
  } catch (e: any) {
    console.error("[orders]", e.message);
    res.status(500).json({ error: "fetch_failed" });
  }
});

apiRouter.patch("/conversations/:waId/automation", async (req, res) => {
  const enabled = !!req.body?.enabled;
  const session = setAutomation(req.params.waId, enabled);
  await prisma.conversation
    .upsert({
      where: { waId: req.params.waId },
      create: { waId: req.params.waId, automationEnabled: enabled },
      update: { automationEnabled: enabled },
    })
    .catch((e) => console.error("[automation]", e.message));

  events.emitDashboard({
    type: "automation_toggle",
    waId: req.params.waId,
    enabled,
    at: Date.now(),
  });
  res.json({ waId: session.waId, automationEnabled: session.automationEnabled });
});

apiRouter.patch("/conversations/:waId/close", async (req, res) => {
  const waId = req.params.waId;
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) { res.status(404).json({ error: "not_found" }); return; }

    const prevState = conv.state;
    await prisma.conversation.update({ where: { waId }, data: { state: "CLOSED" } });

    const session = getSession(waId);
    session.state = "CLOSED" as any;
    await persistOrderIfNeeded(session);

    cancelRemarketing(waId);

    events.emitDashboard({ type: "state_change", waId, from: prevState, to: "CLOSED", at: Date.now() });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[close]", e.message);
    res.status(500).json({ error: "close_failed" });
  }
});

apiRouter.patch("/conversations/:waId/reopen", async (req, res) => {
  const waId = req.params.waId;
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) { res.status(404).json({ error: "not_found" }); return; }
    if (conv.state !== "CLOSED") { res.status(400).json({ error: "not_closed" }); return; }

    const reopenState = "PAYMENT_METHOD";
    await prisma.conversation.update({ where: { waId }, data: { state: reopenState } });

    // Cancel any pending orders so they don't count as sales
    await prisma.order.updateMany({
      where: { conversation: { waId }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    const session = getSession(waId);
    session.state = reopenState as any;

    events.emitDashboard({ type: "state_change", waId, from: "CLOSED", to: reopenState, at: Date.now() });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[reopen]", e.message);
    res.status(500).json({ error: "reopen_failed" });
  }
});

apiRouter.post("/conversations/:waId/send", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "missing_text" });
    return;
  }
  const sanitized = sanitizeOutput(text);
  const waId = req.params.waId;
  const waMsgId = await sendInParts(waId, sanitized);

  const session = getSession(waId);
  session.lastOutboundAt = Date.now();

  try {
    const conv = await prisma.conversation.upsert({
      where: { waId },
      create: { waId, automationEnabled: session.automationEnabled },
      update: { lastOutboundAt: new Date() },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        type: "manual",
        body: sanitized,
        whatsappMsgId: waMsgId ?? null,
      },
    });
  } catch (e: any) {
    console.error("[send.persist]", e.message);
  }

  events.emitDashboard({
    type: "message",
    waId,
    direction: "outbound",
    body: sanitized,
    messageType: "manual",
    at: Date.now(),
  });

  res.json({ ok: true });
});

apiRouter.post(
  "/conversations/:waId/send-media",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) { res.status(400).json({ error: "no_file" }); return; }

    const waId    = String(req.params.waId);
    const caption = String(req.body?.caption ?? "").trim() || undefined;
    const mime    = req.file.mimetype;
    const type    = mimeToMediaType(mime);

    const mediaId = await uploadMedia(req.file.buffer, mime, req.file.originalname);
    if (!mediaId) { res.status(502).json({ error: "upload_failed" }); return; }

    await sendMedia(waId, mediaId, type, caption);

    const label = `[${type}: ${req.file.originalname}]${caption ? " " + caption : ""}`;

    try {
      const conv = await prisma.conversation.upsert({
        where: { waId },
        create: { waId },
        update: { lastOutboundAt: new Date() },
      });
      await prisma.message.create({
        data: { conversationId: conv.id, direction: "outbound", type, body: label },
      });
    } catch (e: any) {
      console.error("[send-media.persist]", e.message);
    }

    events.emitDashboard({
      type: "message", waId, direction: "outbound",
      body: label, messageType: type, at: Date.now(),
    });

    res.json({ ok: true, type, mediaId });
  },
);

apiRouter.get("/metrics/strategies", async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<Array<{
      strategy: string;
      total: bigint;
      interacted: bigint;
      reached_funnel: bigint;
      closed: bigint;
    }>>`
      SELECT
        strategy,
        COUNT(*)::int                                                          AS total,
        COUNT(*) FILTER (WHERE state <> 'GREETING')::int                      AS interacted,
        COUNT(*) FILTER (WHERE state IN ('CONFIRM_ORDER','ADDRESS_COLLECTION','PAYMENT_METHOD','CLOSED'))::int AS reached_funnel,
        COUNT(*) FILTER (WHERE state = 'CLOSED')::int                         AS closed
      FROM freskabox."Conversation"
      GROUP BY strategy
      ORDER BY strategy
    `;

    const result = rows.map(r => ({
      strategy: r.strategy,
      total:        Number(r.total),
      interacted:   Number(r.interacted),
      reachedFunnel:Number(r.reached_funnel),
      closed:       Number(r.closed),
      interactionRate: r.total > 0 ? Math.round(Number(r.interacted)    / Number(r.total) * 100) : 0,
      conversionRate:  r.total > 0 ? Math.round(Number(r.closed)        / Number(r.total) * 100) : 0,
      funnelRate:      r.total > 0 ? Math.round(Number(r.reached_funnel)/ Number(r.total) * 100) : 0,
    }));

    res.json(result);
  } catch (e: any) {
    console.error("[metrics.strategies]", e.message);
    res.status(500).json({ error: "fetch_failed" });
  }
});

apiRouter.delete("/messages/:msgId", async (req, res) => {
  const msgId = req.params.msgId;
  const result = await deleteMessage(msgId);
  if (!result.ok) { res.status(502).json({ error: result.error ?? "delete_failed" }); return; }
  res.json({ ok: true });
});

// Proxy para reproducir audios/imágenes de WhatsApp en el dashboard
// sin exponer el token al frontend
apiRouter.get("/media/:mediaId", async (req, res) => {
  try {
    const apiVersion = config.whatsapp.apiVersion;
    const token      = config.whatsapp.token;
    const metaUrl    = `https://graph.facebook.com/${apiVersion}/${req.params.mediaId}`;

    const meta = await axios.get(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
    });

    const fileUrl = meta.data?.url;
    if (!fileUrl) { res.status(404).json({ error: "not_found" }); return; }

    const file = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "stream",
      timeout: 30_000,
    });

    res.setHeader("Content-Type", String(file.headers["content-type"] || "audio/ogg"));
    res.setHeader("Cache-Control", "private, max-age=3600");
    (file.data as NodeJS.ReadableStream).pipe(res);
  } catch (e: any) {
    console.error("[media.proxy]", e.message);
    res.status(502).json({ error: "fetch_failed" });
  }
});
