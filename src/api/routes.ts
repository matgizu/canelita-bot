import axios from "axios";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { events } from "../events";
import { config } from "../config";
import { getSession, setAutomation } from "../sessions";
import { mimeToMediaType, sendInParts, sendMedia, uploadMedia } from "../whatsapp/client";
import { sanitizeOutput } from "../bot/blocklist";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB
});

export const apiRouter = Router();

apiRouter.get("/conversations", async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastInboundAt: "desc" },
    take: 100,
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

apiRouter.post("/conversations/:waId/send", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "missing_text" });
    return;
  }
  const sanitized = sanitizeOutput(text);
  const waId = req.params.waId;
  await sendInParts(waId, sanitized);

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
