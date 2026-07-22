import { prisma } from "../db";
import { events } from "../events";
import { sendTemplate } from "../whatsapp/templates";
import { COMBOS, REMARKETING_DISCOUNT, formatCOP } from "../products";
import { sleep } from "../whatsapp/client";

// ─── Filtro de destinatarios ────────────────────────────────────────────────

export interface CampaignFilter {
  labels: string[];
  matchAll?: boolean; // true = debe tener TODAS las etiquetas; false = alguna
  excludeClosed?: boolean;
}

export async function findRecipients(filter: CampaignFilter) {
  const where: Record<string, any> = {
    labels: filter.matchAll ? { hasEvery: filter.labels } : { hasSome: filter.labels },
  };
  if (filter.excludeClosed !== false) where.state = { not: "CLOSED" };
  return prisma.conversation.findMany({
    where,
    orderBy: { lastInboundAt: "desc" },
    select: { id: true, waId: true, fullName: true, customerName: true, state: true, labels: true },
  });
}

// Valores sugeridos para las variables de las plantillas conocidas, calculados
// desde los precios reales para que el panel no tenga precios quemados.
export function suggestedVars(templateName: string): string[] {
  const pack3 = COMBOS.find((c) => c.id === "pack3")!.price;
  switch (templateName) {
    case "freskabox_retomar_pedido":
      return [formatCOP(pack3)];
    case "freskabox_retomar_descuento":
      return [formatCOP(pack3 - REMARKETING_DISCOUNT), formatCOP(pack3)];
    default:
      return [];
  }
}

// ─── Estado de la campaña en curso (una a la vez) ───────────────────────────

export interface CampaignStatus {
  running: boolean;
  templateName?: string;
  total?: number;
  sent?: number;
  failed?: number;
  startedAt?: number;
}

let status: CampaignStatus = { running: false };

export function campaignStatus(): CampaignStatus {
  return status;
}

// ─── Envío ──────────────────────────────────────────────────────────────────

export interface StartResult {
  ok?: boolean;
  total?: number;
  error?: string;
}

export async function startCampaign(
  templateName: string,
  variables: string[],
  filter: CampaignFilter,
): Promise<StartResult> {
  if (status.running) return { error: "campaign_already_running" };
  if (!filter.labels?.length) return { error: "labels_required" };

  const tpl = await prisma.template.findUnique({ where: { name: templateName } });
  if (!tpl) return { error: "template_not_found" };
  if (tpl.status !== "APPROVED") return { error: "template_not_approved" };

  const varCount = new Set(Array.from(tpl.body.matchAll(/\{\{(\d+)\}\}/g), (m) => m[1])).size;
  if (variables.length !== varCount) return { error: "variables_mismatch" };

  const recipients = await findRecipients(filter);
  if (!recipients.length) return { error: "no_recipients" };

  status = { running: true, templateName, total: recipients.length, sent: 0, failed: 0, startedAt: Date.now() };

  // Cuerpo con variables ya sustituidas, para el historial del chat.
  const renderedBody = tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[Number(n) - 1] ?? "");

  void (async () => {
    for (const r of recipients) {
      const msgId = await sendTemplate(r.waId, templateName, tpl.language, variables);
      if (msgId) {
        status.sent!++;
        await prisma.conversation.update({
          where: { id: r.id },
          data: { windowExpired: false, lastOutboundAt: new Date() },
        }).catch(() => {});
        await prisma.message.create({
          data: {
            conversationId: r.id,
            direction: "outbound",
            type: "template",
            body: `[plantilla: ${templateName}]\n${renderedBody}`,
          },
        }).catch(() => {});
        events.emitDashboard({
          type: "message", waId: r.waId, direction: "outbound",
          body: `[plantilla: ${templateName}]\n${renderedBody}`,
          messageType: "template", at: Date.now(),
        });
      } else {
        status.failed!++;
      }
      events.emitDashboard({
        type: "campaign_progress", templateName,
        sent: status.sent!, failed: status.failed!, total: status.total!,
        done: false, at: Date.now(),
      });
      // Pausa entre envíos: evita ráfagas que Meta pueda tratar como spam.
      await sleep(1200);
    }
    events.emitDashboard({
      type: "campaign_progress", templateName,
      sent: status.sent!, failed: status.failed!, total: status.total!,
      done: true, at: Date.now(),
    });
    status = { running: false };
  })();

  return { ok: true, total: recipients.length };
}
