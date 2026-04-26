import OpenAI from "openai";
import { config } from "../config";
import { downloadMedia, getMediaUrl } from "./client";

const openai = config.openai.apiKey
  ? new OpenAI({ apiKey: config.openai.apiKey })
  : null;

export async function transcribeAudio(mediaId: string): Promise<string | null> {
  if (!openai) {
    console.warn("[transcribe] OPENAI_API_KEY not set, skipping audio");
    return null;
  }

  const url = await getMediaUrl(mediaId);
  if (!url) return null;

  const buf = await downloadMedia(url);
  if (!buf) return null;

  try {
    const file = new File([new Uint8Array(buf)], "audio.ogg", {
      type: "audio/ogg",
    });
    const res = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });
    return res.text?.trim() ?? null;
  } catch (e: any) {
    console.error("[transcribe]", e.message);
    return null;
  }
}
