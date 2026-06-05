export type ObjectionType =
  | "price"
  | "doubt_fit"
  | "doubt_quality"
  | "no_money_now"
  | "needs_to_think"
  | "needs_to_consult"
  | "dont_need_it"
  | "only_one_enough"
  | "plastic_smell"
  | "fragile"
  | "shipping_cost";

export interface Objection {
  type: ObjectionType;
  triggers: string[];
  validate: string;
  rebut: string;
  followUp: string;
}

export const OBJECTIONS: Objection[] = [
  {
    type: "price",
    triggers: [
      "muy caro",
      "esta caro",
      "está caro",
      "carísimo",
      "carisimo",
      "es mucho",
      "se me sale",
      "no tengo tanto",
      "muy costoso",
      "tan caro",
      "demasiado caro",
    ],
    validate: "Te entiendo, al principio parece.",
    rebut:
      "Pero son 3 cajones que reorganizan toda tu nevera — $23.300 por cajón con envío incluido. Y lo pagas cuando lo recibes, sin arriesgar nada ✨",
    followUp: "¿Lo probamos?",
  },
  {
    type: "doubt_fit",
    triggers: [
      "y si no me cabe",
      "no me va a caber",
      "mi nevera es pequeña",
      "qué medidas tiene",
      "cuánto mide",
      "cuanto mide",
      "y si no encaja",
      "no sé si cabe",
      "no se si cabe",
      "mi nevera es chiquita",
    ],
    validate: "Súper válida la duda.",
    rebut:
      "Son extensibles de 23 a 35 cm — caben en todas las neveras estándar de Colombia, de 1 o 2 puertas. Y si al recibirlos no te caben, no pagas 💛",
    followUp: "¿Lo mandamos?",
  },
  {
    type: "doubt_quality",
    triggers: [
      "eso será de mala calidad",
      "mala calidad",
      "de mal plástico",
      "mal plastico",
      "eso será malo",
      "durará poco",
      "durara poco",
      "no me convence",
      "y si no sirve",
      "no estoy segura",
      "no se si",
    ],
    validate: "Es válido cuestionarlo.",
    rebut:
      "Es plástico ABS alimentario, el mismo que usan los tuppers de calidad — sin BPA, sin olores, apto lavavajillas. Y pagas contraentrega: lo recibes, lo revisas, y si no te convence no pagas ✨",
    followUp: "¿Lo probamos sin riesgo?",
  },
  {
    type: "no_money_now",
    triggers: [
      "no tengo plata",
      "no tengo ahora",
      "ahorita no",
      "cuando me paguen",
      "espero el pago",
      "no tengo efectivo",
      "estoy pelada",
      "estoy pelado",
    ],
    validate: "Te entiendo.",
    rebut:
      "Por eso es contraentrega: hoy no pagas nada. Te llega en 2-4 días hábiles y pagas al transportador cuando lo recibas — si te cae con tu quincena, mejor todavía 💛",
    followUp: "¿Te lo dejo en camino?",
  },
  {
    type: "needs_to_think",
    triggers: [
      "tengo que pensarlo",
      "déjame pensarlo",
      "dejame pensarlo",
      "lo pienso",
      "después te aviso",
      "despues te aviso",
      "déjame ver",
      "dejame ver",
      "lo voy a pensar",
    ],
    validate: "Sin presión.",
    rebut:
      "Si quieres te lo aparto 24 horas con tu nombre para que no se pierda el precio. Te escribo mañana sin compromiso 💛",
    followUp: "¿Te lo aparto?",
  },
  {
    type: "needs_to_consult",
    triggers: [
      "le pregunto a mi esposo",
      "le pregunto a mi esposa",
      "pregunto en casa",
      "consulto",
      "lo comento",
      "hablo con mi pareja",
      "hablo en casa",
      "le comento a mi mamá",
      "le comento a mi marido",
    ],
    validate: "Claro, normal.",
    rebut:
      "Te cuento que es contraentrega — tú recibes el paquete y decides en el momento. No tienes que hacer ningún pago por adelantado ✨",
    followUp: "Entonces el riesgo es cero. ¿Lo pedimos?",
  },
  {
    type: "dont_need_it",
    triggers: [
      "mi nevera ya está bien",
      "ya tengo organizadores",
      "ya organizo",
      "no lo necesito",
      "no necesito eso",
      "mi nevera está organizada",
    ],
    validate: "Qué bueno que ya tienes hábito de organización.",
    rebut:
      "Estos cajones son diferentes — se cuelgan de la repisa y crean una repisa extra. El espacio que normalmente no usas queda aprovechado y todo visible de un vistazo 💛",
    followUp: "¿Los probamos?",
  },
  {
    type: "only_one_enough",
    triggers: [
      "con uno me basta",
      "con uno es suficiente",
      "solo necesito uno",
      "para qué 3",
      "para que 3",
      "solo quiero uno",
    ],
    validate: "Entiendo.",
    rebut:
      "El pack de 3 está pensado para que cada repisa de la nevera tenga su cajón: frutas en una, verduras en otra, sobrantes en otra. Por separado sería mucho más caro ✨",
    followUp: "¿Lo llevamos?",
  },
  {
    type: "plastic_smell",
    triggers: [
      "huele a plástico",
      "huele mal",
      "olor a plastico",
      "contamina",
      "bpa",
      "tóxico",
      "toxico",
      "veneno",
      "daña los alimentos",
    ],
    validate: "Buena pregunta.",
    rebut:
      "Son de plástico ABS alimentario libre de BPA — el mismo estándar de los tuppers de calidad. No transfiere olores ni sabores a los alimentos 💛",
    followUp: "",
  },
  {
    type: "fragile",
    triggers: [
      "se rompe fácil",
      "se rompe facil",
      "eso será frágil",
      "eso sera fragil",
      "qué tan resistente",
      "que tan resistente",
      "se parte",
      "será débil",
      "sera debil",
    ],
    validate: "Te entiendo.",
    rebut:
      "El plástico ABS es resistente — es el mismo material de los tuppers y utensilios de cocina que duran años. Soporta el peso normal de frutas y verduras sin problema ✨",
    followUp: "¿Lo probamos?",
  },
  {
    type: "shipping_cost",
    triggers: [
      "cuánto vale el envío",
      "cuanto vale el envio",
      "costo del envío",
      "costo del envio",
      "envío gratis",
      "envio gratis",
      "pagan el envío",
      "pagan el envio",
    ],
    validate: "",
    rebut:
      "El envío es completamente gratis a toda Colombia 💛 Y pagas el producto cuando te lo entregue el transportador, no antes.",
    followUp: "¿Lo pedimos?",
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function detectObjection(message: string): Objection | null {
  const q = norm(message);
  for (const obj of OBJECTIONS) {
    if (obj.triggers.some((t) => q.includes(norm(t)))) return obj;
  }
  return null;
}

export function buildObjectionResponse(obj: Objection): string {
  return [obj.validate, obj.rebut, obj.followUp]
    .filter(Boolean)
    .join("\n\n");
}

export const HARD_OBJECTION_THRESHOLD = 3;
