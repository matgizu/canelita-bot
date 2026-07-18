import type { DropiOrder } from "./client";

// ─────────────────────────────────────────────────────────────────────────────
// Traducción de los estados crudos de Dropi a "etapas" con cara de cliente.
//
// Dropi maneja ~16 estados; el cliente no entiende "REEXPEDICION" ni quiere un
// mensaje por cada micro-movimiento. Los agrupamos en ETAPAS y solo notificamos
// cuando la etapa CAMBIA (dedup por etapa, no por estado crudo) — así pasar de
// DESPACHADA → EN TRANSITO → BODEGA DESTINO no dispara 3 mensajes.
//
// Los estados problemáticos (NOVEDAD, DEVOLUCION, RECHAZADO) NO mandan un
// mensaje bonito automático: alertan al dueño para intervención humana, que es
// donde se salva o se pierde la venta en COD.
// ─────────────────────────────────────────────────────────────────────────────

export type Stage =
  | "PENDING"
  | "CONFIRMED"
  | "SHIPPED"
  | "ARRIVED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_ATTEMPT"
  | "PICKUP_OFFICE"
  | "DELIVERED"
  | "INCIDENT"
  | "RETURNING"
  | "REJECTED"
  | "CANCELLED"
  | "UNKNOWN";

// Estado crudo de Dropi (normalizado a MAYÚSCULAS) → etapa.
const STATUS_TO_STAGE: Record<string, Stage> = {
  "PENDIENTE": "PENDING",
  "GUIA_GENERADA": "CONFIRMED",
  "PREPARADO PARA TRANSPORTADORA": "CONFIRMED",
  "ENTREGADO A TRANSPORTADORA": "SHIPPED",
  "DESPACHADA": "SHIPPED",
  "EN TRANSITO": "SHIPPED",
  "EN TERMINAL ORIGEN": "SHIPPED",
  "EN TERMINAL DESTINO": "ARRIVED",
  "BODEGA DESTINO": "ARRIVED",
  "EN REPARTO": "OUT_FOR_DELIVERY",
  "INTENTO DE ENTREGA": "DELIVERY_ATTEMPT",
  "RECLAME EN OFICINA": "PICKUP_OFFICE",
  "ENTREGADO": "DELIVERED",
  "NOVEDAD": "INCIDENT",
  "EN REEXPEDICION": "RETURNING",
  "DEVOLUCION": "RETURNING",
  "RECHAZADO": "REJECTED",
  "CANCELADO": "CANCELLED",
};

export function stageOf(status: string | null | undefined): Stage {
  if (!status) return "UNKNOWN";
  return STATUS_TO_STAGE[status.trim().toUpperCase()] ?? "UNKNOWN";
}

export interface StageConfig {
  // ¿Se le manda mensaje al cliente al entrar a esta etapa?
  notifyCustomer: boolean;
  // ¿Se le avisa al dueño para intervención humana?
  alertOwner: boolean;
  // Texto libre para clientes DENTRO de la ventana de 24h de WhatsApp.
  text?: (o: OrderView) => string;
  // Nombre de la plantilla Meta aprobada para clientes FUERA de la ventana,
  // con sus variables en orden. Si no hay plantilla, fuera de ventana no se
  // envía (se registra y ya). Configurable por env (ver config.dropi.templates).
  templateKey?: TemplateKey;
  templateVars?: (o: OrderView) => string[];
}

export type TemplateKey =
  | "shipped"
  | "outForDelivery"
  | "delivered"
  | "deliveryAttempt"
  | "pickupOffice";

// Vista "limpia" del pedido para construir mensajes.
export interface OrderView {
  firstName: string;
  carrier: string;
  guide: string;
  city: string;
  cod: boolean;      // CON RECAUDO
  amount: string;    // total a recaudar, formateado "$69.900"
}

export function toOrderView(o: DropiOrder): OrderView {
  const firstName = (o.name ?? "").trim().split(/\s+/)[0] || "";
  const amountNum = Math.round(Number(o.total_order ?? 0)) || 0;
  return {
    firstName: firstName ? firstName[0].toUpperCase() + firstName.slice(1).toLowerCase() : "",
    carrier: (o.shipping_company ?? o.distribution_company?.name ?? "la transportadora").trim(),
    guide: o.shipping_guide ?? "",
    city: (o.city ?? "").trim(),
    cod: (o.rate_type ?? "").toUpperCase().includes("CON RECAUDO"),
    amount: `$${amountNum.toLocaleString("es-CO")}`,
  };
}

const hi = (o: OrderView) => (o.firstName ? `${o.firstName}, ` : "");

// ─── Configuración por etapa ─────────────────────────────────────────────────
export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  PENDING: { notifyCustomer: false, alertOwner: false },

  CONFIRMED: {
    notifyCustomer: false, // interno: aún no vale la pena avisar
    alertOwner: false,
  },

  SHIPPED: {
    notifyCustomer: true,
    alertOwner: false,
    text: (o) =>
      `🚚 ¡${hi(o)}tu FreskaBox ya va en camino!\n\nSalió con ${o.carrier} rumbo a ${o.city || "tu ciudad"}. Te aviso apenas esté por entregarse. 📦`,
    templateKey: "shipped",
    templateVars: (o) => [o.firstName || "Hola", o.carrier, o.city || "tu ciudad"],
  },

  ARRIVED: {
    notifyCustomer: false, // se fusiona con SHIPPED para no duplicar
    alertOwner: false,
  },

  OUT_FOR_DELIVERY: {
    notifyCustomer: true,
    alertOwner: false,
    text: (o) =>
      o.cod
        ? `📦 ¡${hi(o)}hoy te llega tu FreskaBox! 🎉\n\nEl mensajero de ${o.carrier} sale a entregártela. Ten listos *${o.amount}* en efectivo para el pago contra entrega. 🙌`
        : `📦 ¡${hi(o)}hoy te llega tu FreskaBox! 🎉\n\nEl mensajero de ${o.carrier} sale a entregártela hoy. ¡Atento/a! 🙌`,
    templateKey: "outForDelivery",
    templateVars: (o) => [o.firstName || "Hola", o.carrier, o.amount],
  },

  DELIVERY_ATTEMPT: {
    notifyCustomer: true,
    alertOwner: true, // el dueño puede querer llamar si se repite
    text: (o) =>
      `🔔 ${hi(o)}${o.carrier} intentó entregar tu FreskaBox pero no fue posible. 😕\n\nEscríbenos por aquí para coordinar la reentrega hoy mismo y no perder tu pedido. 🙏`,
    templateKey: "deliveryAttempt",
    templateVars: (o) => [o.firstName || "Hola", o.carrier],
  },

  PICKUP_OFFICE: {
    notifyCustomer: true,
    alertOwner: false,
    text: (o) =>
      `📍 ${hi(o)}tu FreskaBox está lista para reclamar en la oficina de ${o.carrier} en ${o.city || "tu ciudad"}.\n\nLleva tu cédula y la guía *${o.guide}*. Si necesitas ayuda, escríbenos. 🙌`,
    templateKey: "pickupOffice",
    templateVars: (o) => [o.firstName || "Hola", o.carrier, o.guide],
  },

  DELIVERED: {
    notifyCustomer: true,
    alertOwner: false,
    text: (o) =>
      `✅ ¡${hi(o)}tu FreskaBox fue entregada! 🎉\n\nEsperamos que te encante. Cuéntanos qué te pareció 👇 y si tienes cualquier duda para instalarla, aquí estamos. 💛`,
    templateKey: "delivered",
    templateVars: (o) => [o.firstName || "Hola"],
  },

  // Novedad: NO mensaje automático genérico — se enruta a humano.
  INCIDENT: { notifyCustomer: false, alertOwner: true },

  // Devolución / reexpedición: aviso al dueño para intentar rescatar.
  RETURNING: { notifyCustomer: false, alertOwner: true },

  // Rechazado: interno, solo dueño.
  REJECTED: { notifyCustomer: false, alertOwner: true },

  CANCELLED: { notifyCustomer: false, alertOwner: false },

  UNKNOWN: { notifyCustomer: false, alertOwner: false },
};
