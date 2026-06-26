import { sendText } from "./whatsapp/client";
import { config } from "./config";
import { events } from "./events";

let windowOpen = true;

export function ownerWindowStatus(): boolean {
  return windowOpen;
}

export async function notifyOwner(text: string): Promise<void> {
  const to = config.owner.waNumber;
  if (!to) return;
  try {
    const msgId = await sendText(to, text);
    if (msgId) {
      windowOpen = true;
    } else {
      // sendText returns null on window_expired — already logged by client.ts
      if (windowOpen) {
        windowOpen = false;
        console.warn("[owner] ventana WA cerrada — el dueño debe escribirle al bot para reactivar notificaciones");
        events.emitDashboard({ type: "owner_window_expired", at: Date.now() });
      }
    }
  } catch (e: any) {
    console.error("[owner.notify]", e.message);
  }
}

// Notificación de errores al WhatsApp del dueño. Throttle POR tipo de error
// (contexto + primeros chars del detalle) para no inundar el chat durante una
// caída — p. ej. si la API de Claude se cae y fallan 50 conversaciones, el dueño
// recibe UN aviso, no 50. Errores DISTINTOS pasan de inmediato.
const errorNotifyAt = new Map<string, number>();
const ERROR_THROTTLE_MS = 3 * 60 * 1000;

export async function notifyOwnerError(context: string, detail?: string): Promise<void> {
  const key = `${context}::${(detail ?? "").slice(0, 80)}`;
  const now = Date.now();
  const last = errorNotifyAt.get(key) ?? 0;
  if (now - last < ERROR_THROTTLE_MS) return;
  errorNotifyAt.set(key, now);
  // Evita que el mapa crezca sin límite si aparecen muchos errores distintos.
  if (errorNotifyAt.size > 200) errorNotifyAt.clear();

  const lines = [`🚨 *Error en el bot*`, ``, context];
  if (detail) lines.push(``, "```", detail.slice(0, 400), "```");
  await notifyOwner(lines.join("\n"));
}

// Called when the owner sends any message to the bot — reopens the window.
export function markOwnerWindowOpen(): void {
  if (!windowOpen) {
    windowOpen = true;
    console.log("[owner] ventana WA reabierta");
    events.emitDashboard({ type: "owner_window_open", at: Date.now() });
  }
}
