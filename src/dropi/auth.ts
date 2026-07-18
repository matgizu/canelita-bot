import { dropi, DROPI_NEEDS_2FA } from "./client";
import { notifyOwner } from "../owner";

// ─────────────────────────────────────────────────────────────────────────────
// Login interactivo de Dropi por WhatsApp.
//
// La cuenta tiene 2FA con Google Authenticator, así que no se puede loguear solo.
// Flujo: el bot pide el código por WhatsApp al dueño → el dueño responde 6 dígitos
// → el bot los valida contra Dropi y guarda el token real (12h).
//
//   Sync detecta que no hay token  →  requestDropiCode()  →  📲 al dueño
//   Dueño responde "482913"        →  handleOwner2faCode() →  ✅ token guardado
// ─────────────────────────────────────────────────────────────────────────────

// ¿Estamos esperando que el dueño mande el código? Con su marca de tiempo, para
// no volver a pedirlo si ya lo pedimos hace poco (y para que caduque).
let awaitingSince = 0;
const AWAIT_TTL_MS = 12 * 60 * 1000;     // el código temporal de Dropi dura ~1h; pedimos de nuevo pasados 12 min sin respuesta
const REQUEST_COOLDOWN_MS = 10 * 60 * 1000;

export function isAwaitingCode(): boolean {
  return awaitingSince > 0 && Date.now() - awaitingSince < AWAIT_TTL_MS;
}

// Dispara el paso 1 (password → token 2FA) y le pide el código al dueño.
// Idempotente: si ya se pidió hace poco, no vuelve a molestar.
export async function requestDropiCode(force = false): Promise<void> {
  if (!force && isAwaitingCode()) return;
  if (!force && awaitingSince && Date.now() - awaitingSince < REQUEST_COOLDOWN_MS) return;
  try {
    await dropi.requestTwoFactor();
    awaitingSince = Date.now();
    await notifyOwner(
      "🔐 *Necesito renovar el acceso a Dropi.*\n\n" +
      "Mándame el código de *Google Authenticator* (6 dígitos) para reactivar las notificaciones de estado a los clientes. 📲",
    );
  } catch (e: any) {
    console.error("[dropi.auth] no se pudo iniciar 2FA:", e.message);
    await notifyOwner(
      `⚠️ No pude iniciar sesión en Dropi para renovar el acceso: ${String(e.message).slice(0, 120)}`,
    ).catch(() => {});
  }
}

// Procesa un mensaje del dueño. Si estábamos esperando un código y el texto es de
// 6 dígitos, lo valida contra Dropi. Devuelve true si consumió el mensaje (para
// que el handler del dueño NO lo mande al asistente de IA).
export async function handleOwner2faCode(text: string): Promise<boolean> {
  if (!isAwaitingCode()) return false;
  const code = (text.match(/\b(\d{6})\b/) ?? [])[1];
  if (!code) return false;

  try {
    const ok = await dropi.submitTwoFactor(code);
    if (ok) {
      awaitingSince = 0;
      await notifyOwner("✅ ¡Listo! Acceso a Dropi renovado. Las notificaciones de estado siguen andando. 🚚");
      // Corre un barrido de inmediato para no esperar al próximo tick.
      import("./tracker").then(({ runDropiSync }) => runDropiSync().catch(() => {}));
      return true;
    }
    await notifyOwner("❌ Ese código no funcionó (incorrecto o vencido). Mándame uno nuevo del Authenticator. 🔁");
    return true;
  } catch (e: any) {
    if (e.message === DROPI_NEEDS_2FA) {
      // El token temporal venció mientras esperábamos: reiniciamos el flujo.
      await requestDropiCode(true);
      return true;
    }
    console.error("[dropi.auth] error validando código:", e.message);
    await notifyOwner(`⚠️ Error validando el código: ${String(e.message).slice(0, 120)}`).catch(() => {});
    return true;
  }
}
