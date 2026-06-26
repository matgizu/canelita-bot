import express, { Request, Response, Router } from "express";
import { handleInbound, InboundEvent } from "../bot/handler";
import { verifyChallenge, verifySignature } from "../whatsapp/verify";
import { notifyOwnerError } from "../owner";
import { events } from "../events";
import { markWindowExpired, WINDOW_EXPIRED_CODES } from "../whatsapp/client";

export const webhookRouter = Router();

webhookRouter.get("/whatsapp", (req: Request, res: Response) => {
  const challenge = verifyChallenge(
    req.query["hub.mode"] as string,
    req.query["hub.verify_token"] as string,
    req.query["hub.challenge"] as string,
  );
  if (challenge) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

webhookRouter.post(
  "/whatsapp",
  express.raw({ type: "application/json", limit: "5mb" }),
  (req: Request, res: Response) => {
    const sig = req.header("x-hub-signature-256");
    if (!verifySignature(req.body as Buffer, sig)) {
      res.sendStatus(401);
      return;
    }

    res.sendStatus(200);

    let body: any;
    try {
      body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      return;
    }

    setImmediate(() =>
      processWebhook(body).catch((e) => {
        console.error("[webhook]", e);
        notifyOwnerError("Falló el procesamiento de un webhook entrante.", e?.message).catch(() => {});
      }),
    );
  },
);

async function processWebhook(body: any): Promise<void> {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    // entry.id is the WhatsApp Business Account ID — the only place Meta exposes
    // it. Needed for CTWA Conversions API attribution.
    const wabaId: string | undefined = entry?.id ? String(entry.id) : undefined;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const nameByWaId = new Map<string, string>();
      for (const c of contacts) {
        if (c?.wa_id && c?.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
      }
      for (const m of messages) {
        const ev = parseMessage(m, nameByWaId);
        if (ev) {
          ev.wabaId = wabaId;
          handleInbound(ev).catch((e) => {
            console.error("[handleInbound]", e);
            notifyOwnerError(`Error inesperado atendiendo a +${ev.waId}.`, e?.message).catch(() => {});
          });
        }
      }

      // Estados de entrega que reporta WhatsApp de forma ASÍNCRONA. WhatsApp
      // acepta el envío con 200 y luego, por aquí, avisa si el mensaje se
      // entregó, se leyó o FALLÓ. Sin esto, un mensaje rechazado (ventana de
      // 24h cerrada, límite de calidad, número no permitido en cuenta demo,
      // etc.) quedaba como "enviado" en el panel sin avisar a nadie.
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const s of statuses) {
        handleStatus(s).catch((e) => console.error("[status]", e?.message));
      }
    }
  }
}

async function handleStatus(s: any): Promise<void> {
  const status: string | undefined = s?.status; // sent | delivered | read | failed
  const waId: string | undefined = s?.recipient_id;
  const msgId: string | undefined = s?.id;
  if (!status || !waId) return;

  if (status !== "failed") return; // delivered/read/sent: no acción por ahora

  const err = Array.isArray(s.errors) ? s.errors[0] : undefined;
  const code: number | undefined = err?.code;
  const reason: string =
    err?.error_data?.details || err?.title || err?.message || "motivo desconocido";

  console.error(`[wa.status.failed] to=${waId} code=${code ?? "?"} :: ${reason}`);

  // Si fue por ventana cerrada, marca la conversación (muestra la barra en el panel).
  if (code !== undefined && WINDOW_EXPIRED_CODES.has(code)) {
    markWindowExpired(waId).catch(() => {});
  }

  // Avisa al panel en tiempo real para que NO se vea como entregado.
  events.emitDashboard({
    type: "message_failed",
    waId,
    msgId,
    code,
    reason,
    at: Date.now(),
  });

  // Y avisa al dueño por WhatsApp (con throttle por tipo de error).
  notifyOwnerError(
    `Un mensaje a +${waId} NO se entregó.`,
    `Código ${code ?? "?"}: ${reason}`,
  ).catch(() => {});
}

function parseMessage(m: any, names: Map<string, string>): InboundEvent | null {
  const waId = m?.from;
  if (!waId) return null;
  const customerName = names.get(waId);
  const whatsappMsgId = m?.id;

  // Parse CTWA referral if present
  const referral = m.referral
    ? {
        sourceId:  m.referral.source_id  ?? undefined,
        headline:  m.referral.headline   ?? undefined,
        ctwaClid:  m.referral.ctwa_clid  ?? undefined,
      }
    : undefined;

  if (m.type === "text") {
    return { waId, customerName, whatsappMsgId, type: "text", text: m.text?.body ?? "", referral };
  }
  if (m.type === "audio" || m.type === "voice") {
    return { waId, customerName, whatsappMsgId, type: "audio", mediaId: m.audio?.id ?? m.voice?.id, referral };
  }
  if (m.type === "image") {
    return { waId, customerName, whatsappMsgId, type: "image", mediaId: m.image?.id, text: m.image?.caption ?? "", referral };
  }
  if (m.type === "video") {
    return { waId, customerName, whatsappMsgId, type: "video", mediaId: m.video?.id, text: m.video?.caption ?? "", referral };
  }
  if (m.type === "document") {
    return { waId, customerName, whatsappMsgId, type: "document", mediaId: m.document?.id, filename: m.document?.filename, text: m.document?.caption ?? "", referral };
  }
  if (m.type === "interactive") {
    const reply =
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      "";
    return { waId, customerName, whatsappMsgId, type: "text", text: reply, referral };
  }
  return { waId, customerName, whatsappMsgId, type: "other", text: "", referral };
}
