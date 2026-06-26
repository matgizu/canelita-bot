import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COP = (n: number) => "$" + n.toLocaleString("es-CO");
const pct = (a: number, b: number) => (b === 0 ? "0%" : ((a / b) * 100).toFixed(1) + "%");

async function windowStats(label: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [leads, leadsFromAds, activeConvs, orders, inbound, outbound] = await Promise.all([
    prisma.conversation.count({ where: { createdAt: { gte: since } } }),
    prisma.conversation.count({ where: { createdAt: { gte: since }, adSource: { not: null } } }),
    prisma.conversation.count({ where: { lastInboundAt: { gte: since } } }),
    prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { total: true, status: true, paymentMethod: true } }),
    prisma.message.count({ where: { createdAt: { gte: since }, direction: "inbound" } }),
    prisma.message.count({ where: { createdAt: { gte: since }, direction: "outbound" } }),
  ]);

  const orderCount = orders.length;
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const byStatus: Record<string, { n: number; total: number }> = {};
  for (const o of orders) {
    const k = o.status ?? "?";
    byStatus[k] = byStatus[k] ?? { n: 0, total: 0 };
    byStatus[k].n++;
    byStatus[k].total += o.total;
  }
  const byPay: Record<string, number> = {};
  for (const o of orders) byPay[o.paymentMethod ?? "?"] = (byPay[o.paymentMethod ?? "?"] ?? 0) + 1;

  console.log("\n========================================");
  console.log(`  ${label}  (desde ${since.toISOString().slice(0, 16).replace("T", " ")} UTC)`);
  console.log("========================================");
  console.log(`Leads nuevos (conversaciones):   ${leads}`);
  console.log(`  · desde anuncios (CTWA):        ${leadsFromAds}  (${pct(leadsFromAds, leads)})`);
  console.log(`Conversaciones activas (msg in): ${activeConvs}`);
  console.log(`Mensajes:                        ${inbound} entrantes / ${outbound} salientes`);
  console.log(`\nPedidos creados:                 ${orderCount}`);
  console.log(`Ingreso total (suma pedidos):    ${COP(revenue)}`);
  console.log(`Ticket promedio:                 ${orderCount ? COP(Math.round(revenue / orderCount)) : "—"}`);
  console.log(`Conversión (pedidos / leads):    ${pct(orderCount, leads)}`);
  if (Object.keys(byStatus).length) {
    console.log(`Pedidos por estado:`);
    for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1].n - a[1].n))
      console.log(`  · ${k.padEnd(12)} ${v.n}  (${COP(v.total)})`);
  }
  if (Object.keys(byPay).length) {
    console.log(`Pedidos por método de pago:`);
    for (const [k, v] of Object.entries(byPay).sort((a, b) => b[1] - a[1]))
      console.log(`  · ${k.padEnd(14)} ${v}`);
  }
}

async function main() {
  // Snapshot global de estados actuales (no acotado por tiempo, es estado vivo)
  const states = await prisma.conversation.groupBy({ by: ["state"], _count: true });
  const totalConvs = await prisma.conversation.count();
  const totalOrders = await prisma.order.count();

  console.log("################# RESUMEN GLOBAL #################");
  console.log(`Total histórico — conversaciones: ${totalConvs} | pedidos: ${totalOrders}`);
  console.log("Estado actual de las conversaciones:");
  for (const s of states.sort((a, b) => (b._count as number) - (a._count as number)))
    console.log(`  · ${String(s.state).padEnd(20)} ${s._count}`);

  await windowStats("ÚLTIMO MES (30 días)", 30);
  await windowStats("ÚLTIMOS 7 DÍAS", 7);
  await windowStats("ÚLTIMOS 3 DÍAS", 3);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
