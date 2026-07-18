import { config } from "../config";
import { prisma } from "../db";
import { dropi, DROPI_TOKEN_EXPIRED, DROPI_NEEDS_2FA, type DropiOrder } from "./client";
import { requestDropiCode } from "./auth";
import { stageOf, STAGE_CONFIG, toOrderView, type Stage } from "./statusMap";
import { sendText } from "../whatsapp/client";
import { sendTemplate } from "../whatsapp/templates";
import { notifyOwner } from "../owner";

// ─────────────────────────────────────────────────────────────────────────────
// Motor de notificaciones de estado de guía.
//
// Cada barrido:
//   1. Trae los pedidos recientes de Dropi (ventana lookbackDays).
//   2. Compara la ETAPA actual contra la última que se le notificó al cliente.
//   3. Si cambió y la etapa es notificable → manda WhatsApp (texto si el cliente
//      está dentro de la ventana de 24h; si no, plantilla aprobada).
//   4. Los estados problemáticos (novedad/devolución/rechazo) alertan al dueño.
//
// SEGURIDAD DE PRIMER ARRANQUE: la primera vez que se ve un pedido NO se notifica
// nada — solo se "siembra" el registro con su etapa actual. Así, al encender el
// sistema con cientos de pedidos históricos (muchos ya ENTREGADO/RECHAZADO), no
// se dispara un mensaje masivo. Solo las transiciones POSTERIORES notifican.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Avisa al dueño (una vez cada 3h como mucho) que el token de Dropi venció y hay
// que pegar uno nuevo. El token real dura ~12h, así que esto pasa ~2 veces/día.
let tokenExpiredNotifiedAt = 0;
async function notifyTokenExpired(): Promise<void> {
  if (Date.now() - tokenExpiredNotifiedAt < 3 * 60 * 60 * 1000) return;
  tokenExpiredNotifiedAt = Date.now();
  await notifyOwner(
    "🔑 *El token de Dropi venció.*\n\nLas notificaciones de estado están pausadas hasta que pegues uno nuevo en `DROPI_TOKEN`.\n\nEn el navegador (consola de Dropi) corre:\n`copy(JSON.parse(localStorage.DROPI_LoginResult).token)`\ny pégalo en el `.env`.",
  ).catch(() => {});
}

function normPhone(p: string | null | undefined): string {
  let s = String(p ?? "").replace(/\D/g, "");
  if (s.length === 10) s = "57" + s;
  return s;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ¿El cliente está dentro de la ventana de 24h (nos escribió hace poco)?
// Si es así podemos mandar texto libre; si no, hay que usar plantilla.
async function isWithinWindow(waId: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { waId },
    select: { lastInboundAt: true, windowExpired: true },
  });
  if (!conv) return false;
  if (conv.windowExpired) return false;
  return Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;
}

export interface SyncSummary {
  scanned: number;
  seeded: number;        // registros nuevos (sembrados, sin notificar)
  transitions: number;   // cambios de etapa detectados
  notified: number;      // mensajes a clientes enviados
  skippedNoWindow: number; // fuera de ventana y sin plantilla configurada
  ownerAlerts: number;
  errors: number;
  dryRun: boolean;
}

interface SyncOptions {
  dryRun?: boolean;      // true = simula: NO persiste ni envía (preview del script)
  notify?: boolean;      // enviar WhatsApp; default = config.dropi.sendEnabled
  lookbackDays?: number;
}

export async function runDropiSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  // dryRun: no toca la DB ni WhatsApp (solo el script de preview).
  // doNotify: si además se mandan mensajes. El panel refresca con notify:false
  // (actualiza estados sin enviar); el cron usa el default (sendEnabled).
  const dryRun = opts.dryRun ?? false;
  const doNotify = !dryRun && (opts.notify ?? config.dropi.sendEnabled);
  const lookbackDays = opts.lookbackDays ?? config.dropi.lookbackDays;

  const summary: SyncSummary = {
    scanned: 0, seeded: 0, transitions: 0, notified: 0,
    skippedNoWindow: 0, ownerAlerts: 0, errors: 0, dryRun,
  };

  const until = new Date();
  const from = new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let orders: DropiOrder[];
  try {
    orders = await dropi.listAllOrders(
      { from: ymd(from), until: ymd(until) },
      { pageSize: 100, max: 3000 },
    );
  } catch (e: any) {
    summary.errors++;
    if (e.message === DROPI_NEEDS_2FA) {
      console.warn("[dropi.sync] sin token válido — pidiendo código 2FA al dueño");
      if (!dryRun) await requestDropiCode();
    } else if (e.message === DROPI_TOKEN_EXPIRED) {
      console.warn("[dropi.sync] DROPI_TOKEN manual vencido — se necesita pegar uno nuevo");
      if (!dryRun) await notifyTokenExpired();
    } else {
      console.error("[dropi.sync] no se pudo listar pedidos:", e.message);
    }
    return summary;
  }

  // Alertas al dueño agrupadas en un solo mensaje por barrido.
  const ownerLines: string[] = [];

  for (const o of orders) {
    summary.scanned++;
    try {
      const stage = stageOf(o.status);
      const cfg = STAGE_CONFIG[stage];
      const phone = normPhone(o.phone);
      const statusChangedAt = o.updated_at ? new Date(o.updated_at) : null;

      const existing = await prisma.dropiShipment.findUnique({
        where: { dropiOrderId: o.id },
      });

      const base = {
        shippingGuide: o.shipping_guide ?? null,
        phone,
        customerName: [o.name, o.surname].filter(Boolean).join(" ").trim() || null,
        carrier: o.shipping_company ?? o.distribution_company?.name ?? null,
        city: o.city ?? null,
        rateType: o.rate_type ?? null,
        total: Math.round(Number(o.total_order ?? 0)) || 0,
        status: o.status,
        stage,
        statusChangedAt,
      };

      // ── Primer avistamiento: sembrar "al día" (sin notificar el pasado) ──
      if (!existing) {
        if (!dryRun) {
          await prisma.dropiShipment.create({
            data: {
              dropiOrderId: o.id,
              ...base,
              previousStatus: null,
              lastNotifiedStage: stage,
              lastAlertedStage: stage,
            },
          });
        }
        summary.seeded++;
        continue;
      }

      const stageChanged = existing.stage !== stage;
      if (stageChanged) summary.transitions++;

      // La decisión de notificar/alertar se basa en la última etapa ya
      // notificada/alertada (NO en el cambio desde el último barrido). Así, si
      // un refresh persiste el estado sin enviar, el envío no se pierde: sigue
      // pendiente hasta que un barrido con envío lo despache.
      const needsCustomerMsg =
        cfg.notifyCustomer && stage !== existing.lastNotifiedStage && phone.length >= 12;
      const needsOwnerAlert = cfg.alertOwner && stage !== existing.lastAlertedStage;

      // ── Notificación al cliente ──
      let notified = false;
      if (needsCustomerMsg && doNotify) {
        const view = toOrderView(o);
        const inWindow = await isWithinWindow(phone);
        const templateName = cfg.templateKey ? config.dropi.templates[cfg.templateKey] : undefined;
        if (inWindow && cfg.text) {
          notified = !!(await sendText(phone, cfg.text(view)));
        } else if (templateName && cfg.templateVars) {
          notified = !!(await sendTemplate(phone, templateName, config.dropi.templateLang, cfg.templateVars(view)));
        } else {
          summary.skippedNoWindow++; // fuera de ventana y sin plantilla
        }
        if (notified) summary.notified++;
      } else if (needsCustomerMsg && dryRun) {
        const view = toOrderView(o);
        const preview = cfg.text ? cfg.text(view) : "(plantilla)";
        console.log(`[dropi.sync][DRY] ${o.id} →${stage} → ${phone}:\n  ${preview.replace(/\n/g, "\n  ")}`);
      }

      // ── Alerta al dueño (novedad / devolución / rechazo / reintento) ──
      let alerted = false;
      if (needsOwnerAlert && doNotify) {
        const who = base.customerName ?? phone;
        const guide = o.shipping_guide ? ` · guía ${o.shipping_guide}` : "";
        ownerLines.push(`• *${o.status}* — ${who} (${base.carrier ?? "?"}${guide})`);
        summary.ownerAlerts++;
        alerted = true;
      }

      if (!dryRun) {
        await prisma.dropiShipment.update({
          where: { dropiOrderId: o.id },
          data: {
            ...base,
            ...(stageChanged ? { previousStatus: existing.status } : {}),
            ...(notified ? { lastNotifiedStage: stage, notifyCount: { increment: 1 }, lastNotifiedAt: new Date() } : {}),
            ...(alerted ? { lastAlertedStage: stage } : {}),
          },
        });
      }
    } catch (e: any) {
      summary.errors++;
      console.error(`[dropi.sync] error en pedido ${o.id}:`, e.message);
    }
  }

  // Un solo mensaje al dueño con todas las novedades del barrido.
  if (ownerLines.length && !dryRun) {
    const head = `⚠️ *Pedidos que necesitan atención* (${ownerLines.length})\n\n`;
    await notifyOwner(head + ownerLines.slice(0, 40).join("\n")).catch(() => {});
  } else if (ownerLines.length) {
    console.log(`[dropi.sync][DRY] ${ownerLines.length} alertas al dueño:\n${ownerLines.join("\n")}`);
  }

  console.log(
    `[dropi.sync] escaneados=${summary.scanned} sembrados=${summary.seeded} ` +
    `transiciones=${summary.transitions} notificados=${summary.notified} ` +
    `alertas=${summary.ownerAlerts} errores=${summary.errors}${dryRun ? " (DRY-RUN)" : ""}`,
  );

  return summary;
}
