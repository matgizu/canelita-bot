import express, { Request, Response, Router } from "express";
import { handleInbound, InboundEvent } from "../bot/handler";
import { verifyChallenge, verifySignature } from "../whatsapp/verify";
import { notifyOwnerError } from "../owner";

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
    }
  }
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
