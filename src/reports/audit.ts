import { prisma } from "../db";

const DAY = 86_400_000;
const FUNNEL_STATES = ["CONFIRM_ORDER", "ADDRESS_COLLECTION", "PAYMENT_METHOD", "CLOSED"];

export interface PeriodMetrics {
  leads: number;
  leadsAds: number;
  sales: number;
  revenue: number;
  convRate: number;   // ventas / leads
  respRate: number;   // respondieron / leads
  noRespRate: number; // no respondieron / leads
  reachedFunnel: number;
  abandonFunnel: number;
  ticket: number;
}

export interface AuditData {
  generatedAt: number;
  dataSince: string | null; // fecha ISO de la conversación más antigua
  periods: Array<{ key: "3d" | "7d" | "30d"; label: string; cur: PeriodMetrics; prev: PeriodMetrics }>;
  ads30: Array<{ ad: string; leads: number; sales: number; revenue: number; convRate: number }>;
  movers: Array<{ ad: string; prev: number; now: number; delta: number }>;
}

type Conv = { id: number; adSource: string | null; state: string; createdAt: Date };
type Ord = { conversationId: number; total: number; status: string; createdAt: Date };

function windowMetrics(convs: Conv[], orders: Ord[], inb: Map<number, number>, fromMs: number, toMs: number): PeriodMetrics {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const lc = convs.filter((c) => c.createdAt >= from && c.createdAt < to);
  const leads = lc.length;
  const leadsAds = lc.filter((c) => c.adSource).length;
  const responded = lc.filter((c) => (inb.get(c.id) || 0) >= 2).length;
  const noResp = leads - responded;
  const reachedFunnel = lc.filter((c) => FUNNEL_STATES.includes(c.state)).length;
  const closedState = lc.filter((c) => c.state === "CLOSED").length;
  const ord = orders.filter((o) => o.status !== "CANCELLED" && o.createdAt >= from && o.createdAt < to);
  const sales = ord.length;
  const revenue = ord.reduce((s, o) => s + o.total, 0);
  return {
    leads,
    leadsAds,
    sales,
    revenue,
    convRate: leads ? sales / leads : 0,
    respRate: leads ? responded / leads : 0,
    noRespRate: leads ? noResp / leads : 0,
    reachedFunnel,
    abandonFunnel: reachedFunnel - closedState,
    ticket: sales ? revenue / sales : 0,
  };
}

function adBreakdown(convs: Conv[], orders: Ord[], convById: Map<number, Conv>, fromMs: number, toMs: number) {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const m = new Map<string, { leads: number; sales: number; revenue: number }>();
  for (const c of convs) {
    if (c.adSource && c.createdAt >= from && c.createdAt < to) {
      const a = m.get(c.adSource) || { leads: 0, sales: 0, revenue: 0 };
      a.leads++;
      m.set(c.adSource, a);
    }
  }
  for (const o of orders) {
    if (o.status === "CANCELLED" || o.createdAt < from || o.createdAt >= to) continue;
    const c = convById.get(o.conversationId);
    if (!c || !c.adSource) continue;
    const a = m.get(c.adSource) || { leads: 0, sales: 0, revenue: 0 };
    a.sales++;
    a.revenue += o.total;
    m.set(c.adSource, a);
  }
  return Array.from(m, ([ad, v]) => ({ ad, ...v }));
}

export async function buildAuditData(): Promise<AuditData> {
  const now = Date.now();
  const [convs, orders, inboundRows] = await Promise.all([
    prisma.conversation.findMany({ select: { id: true, adSource: true, state: true, createdAt: true } }),
    prisma.order.findMany({ select: { conversationId: true, total: true, status: true, createdAt: true } }),
    prisma.$queryRaw<Array<{ cid: number; c: number }>>`
      SELECT "conversationId" AS cid, COUNT(*)::int AS c
      FROM freskabox."Message" WHERE direction = 'inbound' GROUP BY "conversationId"`,
  ]);

  const inb = new Map(inboundRows.map((r) => [r.cid, Number(r.c)]));
  const convById = new Map(convs.map((c) => [c.id, c]));

  const periods: AuditData["periods"] = [
    { key: "3d",  label: "Últimos 3 días",  cur: windowMetrics(convs, orders, inb, now - 3 * DAY, now),  prev: windowMetrics(convs, orders, inb, now - 6 * DAY, now - 3 * DAY) },
    { key: "7d",  label: "Últimos 7 días",  cur: windowMetrics(convs, orders, inb, now - 7 * DAY, now),  prev: windowMetrics(convs, orders, inb, now - 14 * DAY, now - 7 * DAY) },
    { key: "30d", label: "Últimos 30 días", cur: windowMetrics(convs, orders, inb, now - 30 * DAY, now), prev: windowMetrics(convs, orders, inb, now - 60 * DAY, now - 30 * DAY) },
  ];

  const ads30 = adBreakdown(convs, orders, convById, now - 30 * DAY, now)
    .map((a) => ({ ad: a.ad, leads: a.leads, sales: a.sales, revenue: a.revenue, convRate: a.leads ? a.sales / a.leads : 0 }))
    .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue);

  // Tendencia por anuncio: ventas últimos 7d vs 7d previos.
  const a7 = adBreakdown(convs, orders, convById, now - 7 * DAY, now);
  const a7p = adBreakdown(convs, orders, convById, now - 14 * DAY, now - 7 * DAY);
  const s7 = new Map(a7.map((a) => [a.ad, a.sales]));
  const s7p = new Map(a7p.map((a) => [a.ad, a.sales]));
  const allAds = new Set<string>([...s7.keys(), ...s7p.keys()]);
  const movers = Array.from(allAds, (ad) => {
    const nowN = s7.get(ad) || 0;
    const prevN = s7p.get(ad) || 0;
    return { ad, prev: prevN, now: nowN, delta: nowN - prevN };
  })
    .filter((m) => m.now > 0 || m.prev > 0)
    .sort((a, b) => b.delta - a.delta);

  const dataSince = convs.length
    ? convs.reduce((min, c) => (c.createdAt < min ? c.createdAt : min), convs[0].createdAt).toISOString()
    : null;

  return { generatedAt: now, dataSince, periods, ads30, movers };
}
