import { prisma } from "../db";
import { notifyOwner } from "../owner";
import { notify } from "../telegram";

const COP = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const pct = (a: number, b: number) => (b === 0 ? "0%" : ((a / b) * 100).toFixed(1) + "%");

function monthStartCol(): Date {
  const col = new Date(Date.now() - 5 * 3600 * 1000); // COL = UTC-5
  return new Date(Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), 1, 5, 0, 0));
}
const since = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000);

async function periodBlock(label: string, from: Date): Promise<string> {
  const [leads, leadsAds, inbound, outbound, closed, orders, repliedRows] = await Promise.all([
    prisma.conversation.count({ where: { createdAt: { gte: from } } }),
    prisma.conversation.count({ where: { createdAt: { gte: from }, adSource: { not: null } } }),
    prisma.message.count({ where: { createdAt: { gte: from }, direction: "inbound" } }),
    prisma.message.count({ where: { createdAt: { gte: from }, direction: "outbound" } }),
    // Cerradas en el periodo: por closedAt (fecha real de cierre), no updatedAt.
    prisma.conversation.count({ where: { closedAt: { gte: from } } }),
    prisma.order.findMany({ where: { createdAt: { gte: from }, status: { not: "CANCELLED" } }, select: { total: true } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM (
        SELECT m."conversationId" FROM freskabox."Message" m
        JOIN freskabox."Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'inbound' AND c."createdAt" >= ${from}
        GROUP BY m."conversationId" HAVING COUNT(*) >= 2
      ) s`,
  ]);
  const sales = orders.length;
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const replied = Number(repliedRows[0]?.count ?? 0);
  return [
    `*${label}*`,
    `• Conversaciones nuevas: *${leads}* (${pct(leadsAds, leads)} desde anuncios)`,
    `• Mensajes: *${inbound + outbound}* (entran ${inbound} / salen ${outbound})`,
    `• Respondieron: ${replied} (${pct(replied, leads)})`,
    `• Ventas: *${sales}* | Ingresos: *${COP(revenue)}*`,
    `• Tasa de conversión: *${pct(sales, leads)}*`,
    `• Ticket promedio: ${sales ? COP(revenue / sales) : "—"}`,
    `• Conv. cerradas (estado): ${closed}`,
  ].join("\n");
}

async function adBlock(from: Date): Promise<string> {
  const leadRows = await prisma.$queryRaw<Array<{ ad: string; leads: bigint; closed: bigint }>>`
    SELECT "adSource" AS ad, COUNT(*) AS leads, COUNT(*) FILTER (WHERE state='CLOSED') AS closed
    FROM freskabox."Conversation"
    WHERE "adSource" IS NOT NULL AND "createdAt" >= ${from}
    GROUP BY "adSource"`;
  const revRows = await prisma.$queryRaw<Array<{ ad: string; sales: bigint; revenue: bigint }>>`
    SELECT c."adSource" AS ad, COUNT(o.id) AS sales, COALESCE(SUM(o.total),0) AS revenue
    FROM freskabox."Order" o JOIN freskabox."Conversation" c ON c.id = o."conversationId"
    WHERE o.status <> 'CANCELLED' AND o."createdAt" >= ${from} AND c."adSource" IS NOT NULL
    GROUP BY c."adSource"`;

  const map = new Map<string, { leads: number; sales: number; revenue: number }>();
  for (const r of leadRows) map.set(r.ad, { leads: Number(r.leads), sales: 0, revenue: 0 });
  for (const r of revRows) {
    const m = map.get(r.ad) ?? { leads: 0, sales: 0, revenue: 0 };
    m.sales = Number(r.sales);
    m.revenue = Number(r.revenue);
    map.set(r.ad, m);
  }
  const ads = Array.from(map, ([ad, v]) => ({ ad, ...v }));
  if (!ads.length) return "*ANUNCIOS (este mes)*\n• Sin datos de anuncios.";

  const bySales = [...ads].sort((a, b) => b.sales - a.sales || b.revenue - a.revenue);
  const byRevenue = [...ads].sort((a, b) => b.revenue - a.revenue);
  const byConv = [...ads].filter((a) => a.leads >= 20).sort((a, b) => b.sales / b.leads - a.sales / a.leads);

  const lines = ["*ANUNCIOS (este mes)*"];
  if (bySales[0]) lines.push(`🏆 Más ventas: ad ${bySales[0].ad} → *${bySales[0].sales} ventas*, ${COP(bySales[0].revenue)} (${bySales[0].leads} leads)`);
  if (byConv[0]) lines.push(`🎯 Mejor conversión (≥20 leads): ad ${byConv[0].ad} → *${pct(byConv[0].sales, byConv[0].leads)}*`);
  if (byRevenue[0]) lines.push(`💰 Más ingresos: ad ${byRevenue[0].ad} → *${COP(byRevenue[0].revenue)}*`);
  lines.push("", "Ingresos por anuncio (top 5) — ROAS = ingresos ÷ tu gasto:");
  for (const a of byRevenue.slice(0, 5)) {
    lines.push(`• ${a.ad}: ${COP(a.revenue)} | ${a.sales} ventas | conv ${pct(a.sales, a.leads)}`);
  }
  return lines.join("\n");
}

export async function buildStatsReport(): Promise<string> {
  const stamp = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short" });
  const [mes, d14, d7, d3, ads] = await Promise.all([
    periodBlock("ESTE MES", monthStartCol()),
    periodBlock("ÚLTIMOS 14 DÍAS", since(14)),
    periodBlock("ÚLTIMOS 7 DÍAS", since(7)),
    periodBlock("ÚLTIMOS 3 DÍAS", since(3)),
    adBlock(monthStartCol()),
  ]);
  return [
    `📊 *REPORTE FRESKABOX*`,
    `🗓 ${stamp}`,
    ``, mes, ``, d14, ``, d7, ``, d3, ``, ads,
    ``,
    `_ROAS real requiere el gasto de Meta (ROAS = ingresos ÷ gasto del anuncio)._`,
  ].join("\n");
}

export async function sendStatsToOwner(): Promise<void> {
  try {
    const report = await buildStatsReport();
    await notifyOwner(report);   // WhatsApp del dueño
    await notify(report);        // Telegram (dashboard)
  } catch (e: any) {
    console.error("[statsReport]", e.message);
  }
}
