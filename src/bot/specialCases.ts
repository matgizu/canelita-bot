import { isInternational } from "../coverage";

export type SpecialCase =
  | "wholesaler"
  | "international_shipping"
  | "payment_proof"
  | "testimonials_request"
  | "not_interested"
  | "come_back_later"
  | null;

export interface SpecialCaseResult {
  type: Exclude<SpecialCase, null>;
  response: string;
  disableBot: boolean;
  notifyTelegram: boolean;
  closeOrder?: boolean;
  reminder?: { note: string; daysFromNow: number };
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

// Short, possibly-ambiguous opt-outs — apply word count guard (≤8 words).
// "no gracias" in a long message can be a polite preface before a real question.
const NOT_INTERESTED_TRIGGERS = [
  "no gracias",
  "no, gracias",
  "no lo necesito",
  "no me interesa",
  "no me interesan",
  "nome interesa",
  "nome interesan",
  "nome imteresa",
  "no minteresa",
  "ya no quiero",
  "no quiero nada",
  "no insistas",
  "no insistan",
  "ya dije que no",
];

// Unambiguous "stop messaging me" signals — no word count limit.
// These phrases cannot appear in a genuinely engaged message.
const HARD_OPT_OUT_TRIGGERS = [
  "dejame de escribir",
  "déjame de escribir",
  "dejen de escribirme",
  "dejame de molestar",
  "déjame de molestar",
  "dejen de molestar",
  "no me escribas mas",
  "no me escribas más",
  "no escribas mas",
  "no escribas más",
  "no me molestes",
  "no molesten",
  "no molestes mas",
  "no molestes más",
  "tanta insistidera",
  "tanta insistencia",
  "tan insistentes",
  "no jodan",
  "no joda",
  "dejen de joder",
  "siguen jodiendo",
  "siguen molestando",
  "se les dice que no",
  "ya les dije",
  "ya les dije que no",
  "ya le dije",
  "ya les dije",
  "no manden mas mensajes",
  "no manden más mensajes",
  "no me manden",
  "bloquear",
  "voy a bloquear",
  "los voy a bloquear",
];

const COME_BACK_TRIGGERS = [
  "te aviso",
  "te confirmo",
  "te digo despues",
  "te digo después",
  "te escribo despues",
  "te escribo después",
  "te escribo mas tarde",
  "te escribo más tarde",
  "vuelvo despues",
  "vuelvo después",
  "vuelvo mas tarde",
  "vuelvo más tarde",
  "luego te escribo",
  "luego te confirmo",
  "luego te aviso",
  "mañana te",
  "lo pienso",
  "lo consulto",
  "pregunto a mi",
  "pregunto con mi",
  "consulto con mi",
  "hablo con mi esposo",
  "hablo con mi pareja",
  "hablo con mi mama",
  "hablo con mi mamá",
  "se lo pregunto",
  "se lo consulto",
  "espérame",
  "esperame",
  "dame un momento",
  "en un rato te",
  "ahorita te aviso",
  "ahorita te confirmo",
  "ahorita te digo",
  "déjame pensar",
  "dejame pensar",
  "voy a pensar",
  "voy a consultarlo",
  "voy a preguntarle",
  "gracias por la info",
  "gracias por la informacion",
  "gracias por la información",
  // "not right now" — temporal, not permanent opt-out
  "en el momento no",
  "por el momento no",
  "por ahora no",
  "ahorita no",
  "no por ahora",
  "no por el momento",
  "no en este momento",
  "no ahorita",
  "no por los momentos",
  "en este momento no",
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

  notInterested: `Listo, entendido — no te escribo más. Que tengas un excelente día 💛`,

  comeBackLater: `Listo, sin afán 💛 Aquí estaré cuando quieras.`,
};

export interface DetectInput {
  text: string;
  hasImage?: boolean;
  state?: string;
}

export function detectSpecialCase(input: DetectInput): SpecialCaseResult | null {
  const q = norm(input.text || "");

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

  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const noOrderState = input.state !== "CLOSED" && input.state !== "PAYMENT_METHOD";

  // "te aviso", "lo consulto con mi esposo", "mañana te digo", "en el momento no", etc.
  // Checked BEFORE not_interested so "en el momento no gracias" is treated as a
  // deferral, not a permanent opt-out.
  // Also catches plain "gracias" (1–2 words) outside of completed-order states.
  const isGraciasAlone = wordCount <= 2 && q.startsWith("gracias");
  if (
    (matches(q, COME_BACK_TRIGGERS) && noOrderState) ||
    (isGraciasAlone && noOrderState)
  ) {
    return {
      type: "come_back_later",
      response: RESPONSES.comeBackLater,
      disableBot: false,
      notifyTelegram: false,
      reminder: { note: "Cliente indicó que avisará — hacer seguimiento.", daysFromNow: 1 },
    };
  }

  // Hard opt-outs: unambiguous "stop messaging me" — no word count limit
  if (matches(q, HARD_OPT_OUT_TRIGGERS)) {
    return {
      type: "not_interested",
      response: RESPONSES.notInterested,
      disableBot: true,
      notifyTelegram: true,
    };
  }

  // Soft opt-outs: short messages only — avoid false-positives in longer messages
  // where "no gracias" is a polite preface before a genuine question.
  if (wordCount <= 8 && matches(q, NOT_INTERESTED_TRIGGERS)) {
    return {
      type: "not_interested",
      response: RESPONSES.notInterested,
      disableBot: true,
      notifyTelegram: true,
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

  notInterested: (waId: string, name?: string) =>
    `🚫 *Cliente pidió no más mensajes*\nwaId: ${waId}${name ? `\nNombre: ${name}` : ""}\nBot desactivado y remarketing cancelado para este contacto.`,

  newOrder: (waId: string, summary: string) =>
    `🛍️ *Nuevo pedido confirmado*\nwaId: ${waId}\n\n${summary}`,

  hardObjection: (waId: string, count: number) =>
    `⚠️ *Cliente con objeciones repetidas*\nwaId: ${waId}\nObjeciones: ${count}\nConsiderar intervención humana.`,
};
