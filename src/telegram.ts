import axios from "axios";
import { config } from "./config";

const enabled = !!(config.telegram.botToken && config.telegram.chatId);
const baseURL = enabled
  ? `https://api.telegram.org/bot${config.telegram.botToken}`
  : "";

export async function notify(text: string): Promise<void> {
  if (!enabled) {
    console.log("[telegram disabled]\n", text);
    return;
  }
  try {
    await axios.post(
      `${baseURL}/sendMessage`,
      {
        chat_id: config.telegram.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      },
      { timeout: 10_000 },
    );
  } catch (e: any) {
    console.error("[telegram.notify]", e.response?.data ?? e.message);
  }
}

export async function notifyPhoto(text: string, mediaUrl: string): Promise<void> {
  if (!enabled) {
    console.log("[telegram disabled photo]\n", text, mediaUrl);
    return;
  }
  try {
    await axios.post(
      `${baseURL}/sendMessage`,
      {
        chat_id: config.telegram.chatId,
        text: `${text}\n\n📎 ${mediaUrl}`,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      },
      { timeout: 10_000 },
    );
  } catch (e: any) {
    console.error("[telegram.notifyPhoto]", e.response?.data ?? e.message);
  }
}
