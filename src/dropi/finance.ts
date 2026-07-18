import { prisma } from "../db";
import type { Stage } from "./statusMap";

// ─────────────────────────────────────────────────────────────────────────────
// Finanzas y proyección de la operación, a partir de DropiShipment.
//
// Por pedido, Dropi ya da: total (COD a recaudar), profit (utilidad si se
// entrega) y shippingCost (flete). Con eso calculamos lo recaudado/utilidad de
// lo entregado, lo que falta (en tránsito) y proyectamos cuánto terminarás
// recaudando/ganando bajo 3 escenarios de tasa de entrega.
// ─────────────────────────────────────────────────────────────────────────────

// Etapas ya "resueltas" y en tránsito (que aún pueden entregarse).
const DELIVERED: Stage = "DELIVERED";
const LOST: Stage[] = ["RETURNING", "REJECTED"];
const IN_TRANSIT: Stage[] = [
  "PENDING", "CONFIRMED", "SHIPPED", "ARRIVED",
  "OUT_FOR_DELIVERY", "DELIVERY_ATTEMPT", "PICKUP_OFFICE", "INCIDENT",
];

// Intervalo de Wilson (95%) para una proporción — cotas realistas para los
// escenarios optimista/pesimista a partir de la muestra observada.
function wilson(pos: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = pos / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - spread) / d), high: Math.min(1, (centre + spread) / d) };
}

export interface FinanceScenario {
  key: string; label: string; rate: number;
  deliveredExpected: number;   // pedidos que se entregarían (de los en tránsito)
  collectExpected: number;     // recaudo esperado de esos
  profitFromPending: number;   // utilidad realizada de esos
  returnLossExpected: number;  // pérdida esperada por los que se devuelven
  totalNet: number;            // utilidad neta total proyectada (realizada + pendiente − pérdidas)
}

export interface FinanceResult {
  delivered: { count: number; collected: number; profit: number };
  lost: { count: number; returnLoss: number };
  inTransit: { count: number; potential: number; potentialProfit: number };
  resolved: number;
  deliveryRate: number;        // observada (entregados / resueltos)
  netRealized: number;         // utilidad ya realizada (entregados − pérdidas de devoluciones)
  projection: FinanceScenario[] | null;
}

export async function computeFinance(): Promise<FinanceResult> {
  const rows = await prisma.dropiShipment.findMany({
    where: { stage: { not: "CANCELLED" } },
    select: { stage: true, total: true, profit: true, shippingCost: true },
  });

  const D = { count: 0, collected: 0, profit: 0 };
  const L = { count: 0, returnLoss: 0 };
  const T = { count: 0, potential: 0, potentialProfit: 0 };

  for (const r of rows) {
    if (r.stage === DELIVERED) {
      D.count++; D.collected += r.total; D.profit += r.profit;
    } else if (LOST.includes(r.stage as Stage)) {
      L.count++;
      // Pérdida por devolución: el flete que ya se pagó (ida). Estimación.
      L.returnLoss += r.shippingCost;
    } else if (IN_TRANSIT.includes(r.stage as Stage)) {
      T.count++; T.potential += r.total; T.potentialProfit += r.profit;
    }
  }

  const resolved = D.count + L.count;
  const deliveryRate = resolved ? D.count / resolved : 0;
  const netRealized = D.profit - L.returnLoss;
  const avgReturnLoss = L.count ? L.returnLoss / L.count : 0;

  let projection: FinanceScenario[] | null = null;
  if (T.count > 0 && resolved > 0) {
    const { low, high } = wilson(D.count, resolved);
    const scenario = (key: string, label: string, rateRaw: number): FinanceScenario => {
      const rate = Math.max(0, Math.min(1, rateRaw));
      const profitFromPending = T.potentialProfit * rate;
      const returnLossExpected = T.count * (1 - rate) * avgReturnLoss;
      return {
        key, label, rate,
        deliveredExpected: T.count * rate,
        collectExpected: T.potential * rate,
        profitFromPending,
        returnLossExpected,
        totalNet: netRealized + profitFromPending - returnLossExpected,
      };
    };
    projection = [
      scenario("pesimista", "Pesimista", low),
      scenario("realista", "Realista (tasa actual)", deliveryRate),
      scenario("optimista", "Optimista", high),
    ];
  }

  return {
    delivered: D, lost: L, inTransit: T,
    resolved, deliveryRate, netRealized, projection,
  };
}
