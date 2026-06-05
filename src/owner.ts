import { sendText } from "./whatsapp/client";
import { config } from "./config";

export async function notifyOwner(text: string): Promise<void> {
  const to = config.owner.waNumber;
  if (!to) return;
  try {
    await sendText(to, text);
  } catch (e: any) {
    console.error("[owner.notify]", e.message);
  }
}
