import axios from "axios";
import FormData from "form-data";
import { config } from "../config";
import { prisma } from "../db";
import { events } from "../events";

// WhatsApp error code: message window expired (24h / 72h CTWA)
const WINDOW_EXPIRED_CODES = new Set([131047, 131026]);

async function markWindowExpired(waId: string): Promise<void> {
  try {
    await prisma.conversation.updateMany({
      where: { waId },
      data: { windowExpired: true },
    });
    events.emitDashboard({ type: "window_expired", waId, at: Date.now() });
  } catch {}
}

const baseURL = `https://graph.facebook.com/${config.whatsapp.apiVersion}`;
const phoneId = config.whatsapp.phoneNumberId;

const http = axios.create({
  baseURL,
  headers: {
    Authorization: `Bearer ${config.whatsapp.token}`,
    "Content-Type": "application/json",
  },
  timeout: 15_000,
});

export async function sendText(to: string, body: string): Promise<string | null> {
  try {
    const res = await http.post(`/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    });
    return res.data?.messages?.[0]?.id ?? null;
  } catch (e: any) {
    const code = e.response?.data?.error?.code;
    if (WINDOW_EXPIRED_CODES.has(code)) {
      console.warn(`[wa.windowExpired] ${to}`);
      markWindowExpired(to).catch(() => {});
    } else {
      console.error("[wa.sendText]", e.response?.data ?? e.message);
    }
    return null;
  }
}

export async function markAsRead(messageId: string): Promise<void> {
  try {
    await http.post(`/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (e: any) {
    console.error("[wa.markAsRead]", e.response?.data ?? e.message);
  }
}

export async function sendReaction(
  to: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  try {
    await http.post(`/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
  } catch (e: any) {
    console.error("[wa.sendReaction]", e.response?.data ?? e.message);
  }
}

export async function getMediaUrl(mediaId: string): Promise<string | null> {
  try {
    const res = await http.get(`/${mediaId}`);
    return res.data?.url ?? null;
  } catch (e: any) {
    console.error("[wa.getMediaUrl]", e.response?.data ?? e.message);
    return null;
  }
}

export async function downloadMedia(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${config.whatsapp.token}` },
      timeout: 30_000,
    });
    return Buffer.from(res.data);
  } catch (e: any) {
    console.error("[wa.downloadMedia]", e.message);
    return null;
  }
}

const REACTION_TRIGGERS = [
  { keyword: /\b(gracias|graci+as)\b/i, emoji: "❤️" },
  { keyword: /\b(genial|chimba|qu[eé] chimba)\b/i, emoji: "❤️" },
  { keyword: /\b(perfecto|perfect[oa])\b/i, emoji: "❤️" },
  { keyword: /\b(listo|liso)\b/i, emoji: "❤️" },
];

export function reactionFor(text: string): string | null {
  for (const r of REACTION_TRIGGERS) {
    if (r.keyword.test(text)) return r.emoji;
  }
  return null;
}

export type MediaType = "image" | "video" | "document" | "audio";

export async function sendImageUrl(to: string, url: string, caption?: string): Promise<void> {
  try {
    await http.post(`/${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: url, ...(caption ? { caption } : {}) },
    });
  } catch (e: any) {
    console.error("[wa.sendImageUrl]", e.response?.data ?? e.message);
  }
}

export async function uploadMedia(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", buffer, { filename, contentType: mimeType });
    const res = await axios.post(
      `${baseURL}/${phoneId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
          ...form.getHeaders(),
        },
        timeout: 30_000,
      },
    );
    return res.data?.id ?? null;
  } catch (e: any) {
    console.error("[wa.uploadMedia]", e.response?.data ?? e.message);
    return null;
  }
}

export async function sendMedia(
  to: string,
  mediaId: string,
  type: MediaType,
  caption?: string,
): Promise<string | null> {
  try {
    const payload: Record<string, any> = {
      messaging_product: "whatsapp",
      to,
      type,
      [type]: { id: mediaId, ...(caption ? { caption } : {}) },
    };
    const res = await http.post(`/${phoneId}/messages`, payload);
    return res.data?.messages?.[0]?.id ?? null;
  } catch (e: any) {
    console.error("[wa.sendMedia]", e.response?.data ?? e.message);
    return null;
  }
}

export function mimeToMediaType(mime: string): MediaType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function splitMessage(text: string): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length <= 1) return blocks.length ? blocks : [text.trim()];

  const merged: string[] = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && (last.length + b.length) < 80) {
      merged[merged.length - 1] = `${last}\n\n${b}`;
    } else {
      merged.push(b);
    }
  }
  return merged;
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  try {
    await http.delete(`/${phoneId}/messages/${messageId}`);
    return true;
  } catch (e: any) {
    console.error("[wa.deleteMessage]", e.response?.data ?? e.message);
    return false;
  }
}

export function delayForPart(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(600 + 35 * words, 4000);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendInParts(to: string, fullText: string): Promise<void> {
  const parts = splitMessage(fullText);
  for (let i = 0; i < parts.length; i++) {
    await sendText(to, parts[i]);
    if (i < parts.length - 1) {
      await sleep(delayForPart(parts[i]));
    }
  }
}
