import OpenAI from "openai";
import { Agent as HttpsAgent } from "node:https";
import { config } from "../config";
import { downloadMedia, getMediaUrl } from "./client";
import { notifyOwnerError } from "../owner";

// Mismo problema que con el SDK de Anthropic (ver src/claude/httpAgent.ts):
// la red de Railway cierra los sockets keep-alive inactivos y la siguiente
// llamada reutiliza un socket muerto → "Invalid response body ... Premature
// close" en cada subida a Whisper. keepAlive:false fuerza una conexión nueva
// por llamada; el costo del handshake TLS es despreciable a este volumen.
const openaiHttpsAgent = new HttpsAgent({ keepAlive: false });

const openai = config.openai.apiKey
  ? new OpenAI({ apiKey: config.openai.apiKey, httpAgent: openaiHttpsAgent })
  : null;

export async function transcribeAudio(mediaId: string): Promise<string | null> {
  if (!openai) {
    console.warn("[transcribe] OPENAI_API_KEY not set, skipping audio");
    notifyOwnerError(
      "🎤 No se transcriben audios: falta OPENAI_API_KEY en el .env. El bot está pidiendo a los clientes que escriban.",
    ).catch(() => {});
    return null;
  }

  const url = await getMediaUrl(mediaId);
  if (!url) {
    notifyOwnerError("🎤 No pude transcribir un audio: WhatsApp no devolvió la URL del media.").catch(() => {});
    return null;
  }

  const buf = await downloadMedia(url);
  if (!buf) {
    notifyOwnerError("🎤 No pude transcribir un audio: falló la descarga del media de WhatsApp.").catch(() => {});
    return null;
  }

  try {
    // OpenAI.toFile arma el upload multipart correctamente con un Buffer.
    // Construir un `new File([Uint8Array])` a mano causa el error
    // "Invalid response body ... Premature close" en Node al subir el audio.
    const file = await OpenAI.toFile(buf, "audio.ogg", { type: "audio/ogg" });
    const res = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });
    const text = res.text?.trim() ?? null;
    if (!text) {
      notifyOwnerError("🎤 Whisper devolvió una transcripción vacía para un audio.").catch(() => {});
    }
    return text;
  } catch (e: any) {
    console.error("[transcribe]", e.message);
    notifyOwnerError("🎤 Error transcribiendo un audio (Whisper)", e.message).catch(() => {});
    return null;
  }
}
