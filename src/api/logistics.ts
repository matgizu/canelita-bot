import { Router } from "express";
import { prisma } from "../db";
import { runDropiSync } from "../dropi/tracker";
import { reconcile } from "../dropi/reconcile";
import { STAGE_CONFIG, type OrderView, type Stage } from "../dropi/statusMap";
import { config } from "../config";

export const logisticsRouter = Router();

// Construye la "vista" de un envío (para armar el mensaje) desde la fila de DB.
function viewOf(s: {
  customerName: string | null; carrier: string | null; shippingGuide: string | null;
  city: string | null; rateType: string | null; total: number;
}): OrderView {
  const first = (s.customerName ?? "").trim().split(/\s+/)[0] || "";
  return {
    firstName: first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "",
    carrier: (s.carrier ?? "la transportadora").trim(),
    guide: s.shippingGuide ?? "",
    city: (s.city ?? "").trim(),
    cod: (s.rateType ?? "").toUpperCase().includes("CON RECAUDO"),
    amount: `$${(s.total ?? 0).toLocaleString("es-CO")}`,
  };
}

// Etapas que cuentan como "resueltas" para las tasas de entrega/devolución.
const RESOLVED: Stage[] = ["DELIVERED", "RETURNING", "REJECTED"];

async function buildData() {
  const shipments = await prisma.dropiShipment.findMany({
    orderBy: { statusChangedAt: "desc" },
    take: 500,
  });

  // Conteo por etapa.
  const byStage: Record<string, number> = {};
  const byCarrier: Record<string, number> = {};
  for (const s of shipments) {
    byStage[s.stage] = (byStage[s.stage] ?? 0) + 1;
    const c = s.carrier ?? "—";
    byCarrier[c] = (byCarrier[c] ?? 0) + 1;
  }

  const resolved = RESOLVED.reduce((n, st) => n + (byStage[st] ?? 0), 0);
  const delivered = byStage["DELIVERED"] ?? 0;
  const returned = byStage["RETURNING"] ?? 0;
  const rejected = byStage["REJECTED"] ?? 0;

  const summary = {
    total: shipments.length,
    delivered,
    returned,
    rejected,
    incidents: byStage["INCIDENT"] ?? 0,
    outForDelivery: byStage["OUT_FOR_DELIVERY"] ?? 0,
    inTransit: (byStage["SHIPPED"] ?? 0) + (byStage["ARRIVED"] ?? 0),
    preparing: (byStage["CONFIRMED"] ?? 0) + (byStage["PENDING"] ?? 0),
    deliveryAttempt: byStage["DELIVERY_ATTEMPT"] ?? 0,
    // Tasas sobre pedidos resueltos (entregados + devueltos + rechazados).
    deliveryRate: resolved ? delivered / resolved : 0,
    returnRate: resolved ? (returned + rejected) / resolved : 0,
    resolved,
    byCarrier,
  };

  // Lista de envíos con el mensaje que corresponde a su etapa actual.
  const rows = shipments.map((s) => {
    const cfg = STAGE_CONFIG[s.stage as Stage] ?? STAGE_CONFIG.UNKNOWN;
    const view = viewOf(s);
    const message = cfg.notifyCustomer && cfg.text ? cfg.text(view) : null;
    return {
      dropiOrderId: s.dropiOrderId,
      customerName: s.customerName,
      phone: s.phone,
      carrier: s.carrier,
      city: s.city,
      status: s.status,
      stage: s.stage,
      guide: s.shippingGuide,
      total: s.total,
      cod: view.cod,
      notifyCustomer: cfg.notifyCustomer,
      alertOwner: cfg.alertOwner,
      // Ya se le envió el mensaje de esta etapa al cliente?
      sent: s.lastNotifiedStage === s.stage,
      message,
      statusChangedAt: s.statusChangedAt,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sendEnabled: config.dropi.sendEnabled,
    trackingEnabled: config.dropi.enabled,
    summary,
    shipments: rows,
  };
}

// Lee lo que hay en DB (rápido).
logisticsRouter.get("/data", async (_req, res) => {
  try {
    res.json(await buildData());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Refresca desde Dropi (actualiza estados) y devuelve los datos frescos.
// notify:false → el panel NO dispara mensajes; de eso se encarga el cron.
logisticsRouter.post("/refresh", async (_req, res) => {
  try {
    const sync = await runDropiSync({ notify: false });
    const data = await buildData();
    res.json({ ...data, sync });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Conciliación: cruza los pedidos del bot con los de Dropi (por teléfono) ──
logisticsRouter.get("/reconcile", async (_req, res) => {
  try {
    res.json(await reconcile());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
