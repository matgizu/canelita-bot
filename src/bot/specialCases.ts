import { isInternational } from "../coverage";

export type SpecialCase =
  | "wholesaler"
  | "international_shipping"
  | "payment_proof"
  | "testimonials_request"
  | "pickup_office"
  | null;

export interface SpecialCaseResult {
  type: Exclude<SpecialCase, null>;
  response: string;
  disableBot: boolean;
  notifyTelegram: boolean;
  closeOrder?: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const WHOLESALER_TRIGGERS = [
  "para revender",
  "soy distribuidora",
  "soy distribuidor",
  "al por mayor",
  "mayorista",
  "tengo tienda",
  "lo distribuyo",
  "para distribuir",
  "necesito un precio especial",
  "precio mayorista",
  "precio al por mayor",
  "10 unidades",
  "12 unidades",
  "15 unidades",
  "20 unidades",
  "25 unidades",
  "30 unidades",
  "50 unidades",
  "100 unidades",
];


const PICKUP_OFFICE_TRIGGERS = [
  "en oficina",
  "recoger en oficina",
  "reclamar en oficina",
  "lo recojo en oficina",
  "recoger en la oficina",
  "reclamar en la oficina",
  "recojo en oficina",
  "voy a recoger",
  "lo recojo yo",
  "recoger en correspondencia",
  "correspondencia",
  "servientrega",
  "interrapidisimo",
  "deprisa",
  "en la oficina de",
  "recoger en el punto",
  "recojo en el punto",
];

const TESTIMONIALS_TRIGGERS = [
  "fotos de testimonio",
  "fotos de resultado",
  "fotos de resultados",
  "fotos reales",
  "ver fotos",
  "mas fotos",
  "más fotos",
  "puedo ver fotos",
  "muestrame fotos",
  "muéstrame fotos",
  "antes y despues",
  "antes y después",
  "fotos de clientas",
  "resultados reales",
  "evidencias",
  "me mandas fotos",
  "me muestras fotos",
];

const PAYMENT_PROOF_TRIGGERS = [
  "comprobante",
  "le envío el comprobante",
  "le envio el comprobante",
  "ya pagué",
  "ya pague",
  "ya transferí",
  "ya transferi",
  "ya hice el pago",
  "soporte de pago",
];

const RESPONSES = {
  wholesaler: `¡Qué bueno saber de ti! Te paso de una vez con mi compañero del área de mayoreo, él maneja precios especiales para distribuidores y revendedores. En un ratico te escribe 💛`,

  international: `Por ahora solo enviamos dentro de Colombia, pero pronto vamos a estar en otros países ✨ ¿Tienes alguien acá que te lo pueda recibir?`,

  testimonials: `Mira cómo quedan las neveras con los cajones ✨ Todo organizado y visible. ¿Te animas?`,

  paymentProof: `Listo, ya recibí tu comprobante. Lo verifico en máximo 30 minutos y te confirmo el despacho 💛`,
};

export interface DetectInput {
  text: string;
  hasImage?: boolean;
  state?: string;
}

export function detectSpecialCase(input: DetectInput): SpecialCaseResult | null {
  const q = norm(input.text || "");

  if (matches(q, PICKUP_OFFICE_TRIGGERS)) {
    return {
      type: "pickup_office",
      response: "__PICKUP_OFFICE__", // filled dynamically in handler.ts
      disableBot: false,
      notifyTelegram: false,
    };
  }

  if (matches(q, TESTIMONIALS_TRIGGERS)) {
    return {
      type: "testimonials_request",
      response: RESPONSES.testimonials,
      disableBot: false,
      notifyTelegram: false,
    };
  }

  if (input.hasImage && (input.state === "PAYMENT_METHOD" || matches(q, PAYMENT_PROOF_TRIGGERS))) {
    return {
      type: "payment_proof",
      response: RESPONSES.paymentProof,
      disableBot: false,
      notifyTelegram: true,
      closeOrder: true,
    };
  }

  if (matches(q, WHOLESALER_TRIGGERS)) {
    return {
      type: "wholesaler",
      response: RESPONSES.wholesaler,
      disableBot: true,
      notifyTelegram: true,
    };
  }

  if (isInternational(input.text)) {
    return {
      type: "international_shipping",
      response: RESPONSES.international,
      disableBot: false,
      notifyTelegram: false,
    };
  }

  return null;
}

function matches(qNormalized: string, triggers: string[]): boolean {
  return triggers.some((t) => qNormalized.includes(norm(t)));
}

export const TELEGRAM_TEMPLATES = {
  wholesaler: (waId: string, name?: string) =>
    `🏷️ *Consulta mayorista*\nwaId: ${waId}${name ? `\nNombre: ${name}` : ""}\nBot desactivado, atender manualmente.`,

  paymentProof: (waId: string, name?: string) =>
    `💳 *Comprobante de pago recibido*\nwaId: ${waId}${name ? `\nNombre: ${name}` : ""}\nVerificar y despachar.`,

  newOrder: (waId: string, summary: string) =>
    `🛍️ *Nuevo pedido confirmado*\nwaId: ${waId}\n\n${summary}`,

  hardObjection: (waId: string, count: number) =>
    `⚠️ *Cliente con objeciones repetidas*\nwaId: ${waId}\nObjeciones: ${count}\nConsiderar intervención humana.`,
};
