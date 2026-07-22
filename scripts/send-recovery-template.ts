// Envía la plantilla de recuperación a conversaciones con ventana vencida que
// nunca cerraron compra. Dry-run por defecto: lista a quién le llegaría.
//
// Uso:
//   npx tsx --env-file=.env scripts/send-recovery-template.ts                 # dry-run
//   npx tsx --env-file=.env scripts/send-recovery-template.ts --send         # envía a todos
//   npx tsx --env-file=.env scripts/send-recovery-template.ts --send --limit 10
//   npx tsx --env-file=.env scripts/send-recovery-template.ts --send --to 573001234567
//   npx tsx --env-file=.env scripts/send-recovery-template.ts --tpl freskabox_retomar_descuento --send
import { prisma } from "../src/db";
import { sendTemplate } from "../src/whatsapp/templates";
import { COMBOS, REMARKETING_DISCOUNT, formatCOP } from "../src/products";
import { sleep } from "../src/whatsapp/client";

const argv = process.argv.slice(2);
const SEND = argv.includes("--send");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;
const toIdx = argv.indexOf("--to");
const ONLY_TO = toIdx >= 0 ? argv[toIdx + 1] : null;
const tplIdx = argv.indexOf("--tpl");
const TPL_NAME = tplIdx >= 0 ? argv[tplIdx + 1] : "freskabox_retomar_pedido";

const pack3 = COMBOS.find((c) => c.id === "pack3")!.price;
const VARS_BY_TPL: Record<string, string[]> = {
  freskabox_retomar_pedido: [formatCOP(pack3)],
  freskabox_retomar_descuento: [formatCOP(pack3 - REMARKETING_DISCOUNT), formatCOP(pack3)],
};

async function main() {
  const tpl = await prisma.template.findUnique({ where: { name: TPL_NAME } });
  if (!tpl) throw new Error(`plantilla ${TPL_NAME} no existe en la BD`);
  if (SEND && tpl.status !== "APPROVED") {
    throw new Error(`plantilla ${TPL_NAME} no está APPROVED (status=${tpl.status})`);
  }
  const variables = VARS_BY_TPL[TPL_NAME];
  if (!variables) throw new Error(`no hay variables definidas para ${TPL_NAME}`);

  const targets = await prisma.conversation.findMany({
    where: ONLY_TO
      ? { waId: ONLY_TO }
      : { windowExpired: true, state: { not: "CLOSED" } },
    orderBy: { lastInboundAt: "desc" },
    select: { id: true, waId: true, fullName: true, customerName: true, state: true },
  });

  const batch = targets.slice(0, Number.isFinite(LIMIT) ? LIMIT : targets.length);
  console.log(`${targets.length} destinatarios (enviando a ${batch.length}) — plantilla ${TPL_NAME}, vars: ${variables.join(" | ")}`);

  let sent = 0, failed = 0;
  for (const c of batch) {
    const who = c.fullName ?? c.customerName ?? "(sin nombre)";
    if (!SEND) {
      console.log(`[dry-run] ${c.waId} ${who} [${c.state}]`);
      continue;
    }
    const msgId = await sendTemplate(c.waId, TPL_NAME, tpl.language, variables);
    if (msgId) {
      sent++;
      await prisma.conversation.update({
        where: { id: c.id },
        data: { windowExpired: false, lastOutboundAt: new Date() },
      }).catch(() => {});
      await prisma.message.create({
        data: {
          conversationId: c.id,
          direction: "outbound",
          type: "template",
          body: `[plantilla: ${TPL_NAME}]\n${tpl.body}`,
        },
      }).catch(() => {});
      console.log(`[sent] ${c.waId} ${who}`);
    } else {
      failed++;
      console.log(`[fail] ${c.waId} ${who}`);
    }
    // Pausa entre envíos para no disparar rate limits ni parecer spam burst.
    await sleep(1200);
  }
  console.log(SEND ? `Listo: ${sent} enviados, ${failed} fallidos.` : "Dry-run terminado. Agrega --send para enviar.");
  await prisma.$disconnect();
}

main();
