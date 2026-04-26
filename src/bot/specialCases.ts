import { isInternational } from "../coverage";

export type SpecialCase =
  | "wholesaler"
  | "international_shipping"
  | "payment_proof"
  | "is_original"
  | "laser_depilation"
  | "face_application"
  | "pregnancy_lactation"
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

const LASER_TRIGGERS = [
  "depilación láser",
  "depilacion laser",
  "depilación con láser",
  "depilacion con laser",
  "estoy en láser",
  "estoy en laser",
  "tratamiento láser",
  "tratamiento laser",
];

const FACE_TRIGGERS = [
  "se aplica en la cara",
  "se aplica en la carita",
  "se puede en la cara",
  "se puede en el rostro",
  "para la cara",
  "para el rostro",
  "en mi cara",
];

const PREGNANCY_TRIGGERS = [
  "estoy embarazada",
  "embarazo",
  "estoy en embarazo",
  "estoy lactando",
  "lactancia",
  "estoy amamantando",
  "estoy dando pecho",
];

const IS_ORIGINAL_TRIGGERS = [
  "es original",
  "será original",
  "sera original",
  "es legítimo",
  "es legitimo",
  "no es falsificación",
  "no es falsificacion",
  "es de verdad",
  "no es pirata",
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
  wholesaler: `¡Qué bueno saber de ti! Te paso de una vez con mi compañera del área de mayoreo, ella maneja precios especiales para distribuidoras y revendedoras. En un ratico te escribe 💛`,

  international: `Por ahora solo enviamos dentro de Colombia, pero pronto vamos a estar en otros países ✨ ¿Tienes alguien acá que te lo pueda recibir?`,

  paymentProof: `Listo, ya recibí tu comprobante. Lo verifico en máximo 30 minutos y te confirmo el despacho 💛`,

  isOriginal: `Sí mi reina, somos distribuidor autorizado de Canelita Hollywood ✨ Si quieres te paso el sello de garantía. El producto te llega sellado y con caja original.`,

  laser: `Una cosita importante: el activo bronceador es DHA. Si estás en proceso de depilación láser, antes de aplicarte Canelita pregúntale a tu profesional si interfiere con el tratamiento. Por seguridad tuya 💛`,

  face: `Canelita es para el cuerpo reina, no para la cara porque esa zona es muy sensible. Para la carita hay otros productos especializados ✨`,

  pregnancy: `Te recomiendo consultar con tu médico antes de usar cualquier producto cosmético en el embarazo o lactancia, por seguridad tuya y del bebé 💛 Si quieres avanzamos con el pedido y lo apartas para cuando puedas usarlo.`,
};

export interface DetectInput {
  text: string;
  hasImage?: boolean;
  state?: string;
}

export function detectSpecialCase(input: DetectInput): SpecialCaseResult | null {
  const q = norm(input.text || "");

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

  if (matches(q, PREGNANCY_TRIGGERS)) {
    return {
      type: "pregnancy_lactation",
      response: RESPONSES.pregnancy,
      disableBot: false,
      notifyTelegram: false,
    };
  }

  if (matches(q, LASER_TRIGGERS)) {
    return {
      type: "laser_depilation",
      response: RESPONSES.laser,
      disableBot: false,
      notifyTelegram: false,
    };
  }

  if (matches(q, FACE_TRIGGERS)) {
    return {
      type: "face_application",
      response: RESPONSES.face,
      disableBot: false,
      notifyTelegram: false,
    };
  }

  if (matches(q, IS_ORIGINAL_TRIGGERS)) {
    return {
      type: "is_original",
      response: RESPONSES.isOriginal,
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
