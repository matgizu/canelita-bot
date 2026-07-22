// Registra en Meta las plantillas del bot (tracking Dropi + remarketing) y las
// refleja en la tabla Template. Idempotente: si ya existe en Meta, sincroniza.
// Uso: npx tsx --env-file=.env scripts/create-templates.ts
import { submitToMeta, syncFromMeta } from "../src/whatsapp/templates";
import { prisma } from "../src/db";

interface Def {
  name: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  examples: string[];
}

// Las variables siguen el orden de templateVars en src/dropi/statusMap.ts.
// {{1}} recibe el nombre o el literal "Hola" — el cuerpo debe leerse bien con ambos.
const TEMPLATES: Def[] = [
  {
    // shipped: {{1}} nombre, {{2}} transportadora, {{3}} ciudad
    name: "freskabox_despachado",
    category: "UTILITY",
    body: `🚚 ¡{{1}}, tu FreskaBox ya va en camino!\n\nSalió con {{2}} rumbo a {{3}}. En unas horas te compartimos el número de guía y te avisamos por aquí apenas esté por entregarse. 📦\n\nCualquier duda nos escribes. ¡Gracias por confiar en nosotros!`,
    examples: ["Laura", "Interrapidísimo", "Medellín"],
  },
  {
    // outForDelivery: {{1}} nombre, {{2}} transportadora, {{3}} monto "$69.900"
    name: "freskabox_en_reparto",
    category: "UTILITY",
    body: `📦 ¡{{1}}, hoy te llega tu FreskaBox! 🎉\n\nEl mensajero de {{2}} sale a entregártela. Ten listos {{3}} en efectivo para el pago contra entrega. 🙌`,
    examples: ["Laura", "Interrapidísimo", "$69.900"],
  },
  {
    // deliveryAttempt: {{1}} nombre, {{2}} transportadora
    name: "freskabox_intento_entrega",
    category: "UTILITY",
    body: `🔔 {{1}}, la transportadora {{2}} intentó entregar tu FreskaBox pero no fue posible. 😕\n\nRespóndenos este mensaje para coordinar la reentrega hoy mismo y no perder tu pedido. 🙏`,
    examples: ["Laura", "Interrapidísimo"],
  },
  {
    // pickupOffice: {{1}} nombre, {{2}} transportadora, {{3}} guía
    name: "freskabox_recoger_oficina",
    category: "UTILITY",
    body: `📍 {{1}}, tu FreskaBox está lista para reclamar en la oficina de {{2}} de tu ciudad.\n\nLleva tu cédula y el número de guía {{3}}. Si necesitas ayuda, escríbenos por aquí. 🙌`,
    examples: ["Laura", "Interrapidísimo", "240012345678"],
  },
  {
    // delivered: {{1}} nombre
    name: "freskabox_entregado",
    category: "UTILITY",
    body: `✅ ¡{{1}}, tu FreskaBox fue entregada! 🎉\n\nEsperamos que te encante. Cuéntanos qué te pareció, y si necesitas ayuda para instalarla escríbenos por aquí. 💛`,
    examples: ["Laura"],
  },
  {
    // Recuperación de leads con ventana vencida. {{1}} = precio pack x3 ("$69.900")
    name: "freskabox_retomar_pedido",
    category: "MARKETING",
    body: `¡Buenas! 🌿 Te escribimos de FreskaBox: quedaste a un paso de completar tu pedido de los cajones organizadores de nevera.\n\nEl pack x3 sigue en {{1}} con envío gratis a toda Colombia y pagas cuando lo recibes, sin riesgo.\n\n¿Lo pedimos hoy? Responde este mensaje y lo dejamos listo.`,
    examples: ["$69.900"],
  },
  {
    // Variante con descuento. {{1}} = precio con descuento ("$59.900"), {{2}} = precio normal
    name: "freskabox_retomar_descuento",
    category: "MARKETING",
    body: `¡Buenas! 🌿 Te escribimos de FreskaBox porque tu pedido de los cajones organizadores quedó pendiente y no queremos que lo pierdas.\n\nSi lo confirmas hoy te dejamos el pack x3 en {{1}} (precio normal {{2}}), con envío gratis a toda Colombia y pago contra entrega, sin riesgo.\n\n¿Te lo enviamos? Responde este mensaje y lo dejamos listo.`,
    examples: ["$59.900", "$69.900"],
  },
];

async function main() {
  for (const t of TEMPLATES) {
    try {
      const res = await submitToMeta(t.name, t.category, "es", t.body, t.examples);
      console.log(`[OK] ${t.name} → id=${res.id} status=${res.status}`);
      await prisma.template.upsert({
        where: { name: t.name },
        create: {
          name: t.name,
          category: t.category,
          language: "es",
          body: t.body,
          metaId: String(res.id),
          status: res.status ?? "PENDING",
        },
        update: {
          category: t.category,
          language: "es",
          body: t.body,
          metaId: String(res.id),
          status: res.status ?? "PENDING",
          rejectionReason: null,
        },
      });
    } catch (e: any) {
      const err = e.response?.data?.error;
      console.error(`[FAIL] ${t.name}:`, err?.error_user_msg ?? err?.message ?? e.message);
    }
  }
  await syncFromMeta();
  const rows = await prisma.template.findMany({
    select: { name: true, category: true, status: true, rejectionReason: true },
    orderBy: { name: "asc" },
  });
  console.table(rows);
  await prisma.$disconnect();
}

main();
