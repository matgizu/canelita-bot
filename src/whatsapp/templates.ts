import axios from "axios";
import { config } from "../config";
import { prisma } from "../db";

const baseURL = `https://graph.facebook.com/${config.whatsapp.apiVersion}`;

function headers() {
  return { Authorization: `Bearer ${config.whatsapp.token}`, "Content-Type": "application/json" };
}

// ─── Meta API calls ─────────────────────────────────────────────────────────

export async function submitToMeta(
  name: string,
  category: string,
  language: string,
  body: string,
  examples: string[] = [],
) {
  const wabaId = config.whatsapp.wabaId;
  if (!wabaId) throw new Error("WHATSAPP_WABA_ID not configured");

  // Meta rechaza con INVALID_FORMAT cualquier body con {{n}} sin ejemplos.
  // Si el caller no los da, se generan genéricos según cuántas variables haya.
  const varCount = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => m[1])).size;
  if (varCount > 0 && examples.length === 0) {
    examples = Array.from({ length: varCount }, (_, i) => `ejemplo${i + 1}`);
  }
  const component: Record<string, any> = { type: "BODY", text: body };
  if (examples.length > 0) component.example = { body_text: [examples] };

  const res = await axios.post(
    `${baseURL}/${wabaId}/message_templates`,
    {
      name,
      category,
      language,
      // Si Meta clasifica distinto (p.ej. UTILITY→MARKETING) acepta el cambio
      // en vez de rechazar con INCORRECT_CATEGORY.
      allow_category_change: true,
      components: [component],
    },
    { headers: headers(), timeout: 15_000 },
  );
  return res.data as { id: string; status: string; category?: string };
}

export async function deleteFromMeta(name: string): Promise<boolean> {
  const wabaId = config.whatsapp.wabaId;
  if (!wabaId) throw new Error("WHATSAPP_WABA_ID not configured");
  try {
    await axios.delete(`${baseURL}/${wabaId}/message_templates`, {
      params: { name },
      headers: headers(),
      timeout: 15_000,
    });
    return true;
  } catch (e: any) {
    console.error("[templates.delete]", e.response?.data ?? e.message);
    return false;
  }
}

export async function syncFromMeta(): Promise<void> {
  const wabaId = config.whatsapp.wabaId;
  if (!wabaId) return;

  try {
    const res = await axios.get(`${baseURL}/${wabaId}/message_templates`, {
      params: {
        fields: "id,name,category,language,status,components,rejected_reason",
        limit: 100,
      },
      headers: headers(),
      timeout: 15_000,
    });

    const metaTemplates: any[] = res.data?.data ?? [];
    for (const mt of metaTemplates) {
      const bodyComp = (mt.components ?? []).find((c: any) => c.type === "BODY");
      const bodyText = bodyComp?.text ?? "";
      await prisma.template.upsert({
        where: { name: mt.name },
        create: {
          name: mt.name,
          category: mt.category ?? "MARKETING",
          language: mt.language ?? "es",
          body: bodyText,
          metaId: String(mt.id),
          status: mt.status ?? "PENDING",
          rejectionReason: mt.rejected_reason ?? null,
        },
        update: {
          metaId: String(mt.id),
          status: mt.status ?? "PENDING",
          rejectionReason: mt.rejected_reason ?? null,
        },
      });
    }
  } catch (e: any) {
    console.error("[templates.sync]", e.response?.data ?? e.message);
  }
}

export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  variables: string[] = [],
): Promise<string | null> {
  const phoneId = config.whatsapp.phoneNumberId;
  const components =
    variables.length > 0
      ? [{ type: "body", parameters: variables.map((v) => ({ type: "text", text: v })) }]
      : [];

  try {
    const res = await axios.post(
      `${baseURL}/${phoneId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      },
      { headers: headers(), timeout: 15_000 },
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (e: any) {
    console.error("[templates.send]", e.response?.data ?? e.message);
    return null;
  }
}
