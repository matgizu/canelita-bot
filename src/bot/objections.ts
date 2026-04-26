export type ObjectionType =
  | "price"
  | "doubt_results"
  | "safety"
  | "stains_clothes"
  | "no_money_now"
  | "needs_to_think"
  | "comparison_solarium"
  | "duration"
  | "smell"
  | "skin_type"
  | "is_original";

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
    ],
    validate:
      "Te entiendo total reina, al principio puede parecer un poco.",
    rebut:
      "Pero mira: una sesión de solarium o cama bronceadora cuesta entre $50.000 y $80.000 y dura pocos días. Canelita te dura hasta 10 días y rinde para varias aplicaciones, sin el daño del sol en la piel ✨",
    followUp:
      "Si quieres empezamos con una sola unidad para que lo pruebes ($69.900 con envío gratis y pagas cuando recibes). ¿Te lo mando?",
  },
  {
    type: "doubt_results",
    triggers: [
      "y si no me gusta",
      "y si no funciona",
      "y si no me sirve",
      "no estoy segura",
      "no se si",
    ],
    validate: "Fresca, eso es súper válido.",
    rebut:
      "Por eso pagas contraentrega: recibes el producto, lo revisas, y si todo bien pagas. Si al verlo no te convence, no pagas y no pasa nada 💛",
    followUp: "No tienes nada que arriesgar. ¿Lo mandamos?",
  },
  {
    type: "safety",
    triggers: [
      "es seguro",
      "hace daño",
      "tiene químicos",
      "tiene quimicos",
      "irrita",
      "alergia",
      "alérgica",
      "alergica",
      "parabenos",
    ],
    validate: "Buena pregunta reina, te tranquilizo de una.",
    rebut:
      "Canelita es 100% libre de parabenos y libre de colorantes artificiales. Tiene DHA derivado de caña de azúcar, colágeno, vitamina E, aminoácidos de coco y elastina. Ingredientes pensados para cuidar la piel ✨",
    followUp: "¿Tienes alguna alergia específica para revisarlo contigo?",
  },
  {
    type: "stains_clothes",
    triggers: [
      "mancha la ropa",
      "mancha las sábanas",
      "mancha las sabanas",
      "se corre",
      "deja marca",
    ],
    validate: "Súper válida la duda.",
    rebut:
      "Solo hay que dejarlo secar 10 minutos antes de vestirte. Cuando seca queda fijo en la piel y no pasa a la ropa ni a las sábanas. Y tampoco se cae con el agua 💛",
    followUp: "",
  },
  {
    type: "no_money_now",
    triggers: [
      "no tengo plata",
      "no tengo ahora",
      "ahorita no",
      "cuando me paguen",
      "espero el pago",
    ],
    validate: "Tranquila reina, te entiendo.",
    rebut:
      "Por eso es contraentrega: hoy no pagas nada. Te llega en 2 a 4 días hábiles y pagas al transportador cuando lo recibas. Si te coincide con tu pago, mejor todavía ✨",
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
    ],
    validate: "Claro reina, sin presión.",
    rebut:
      "Si quieres te lo aparto por 24 horas con tu nombre para que no se te vaya el precio actual. Te escribo mañana sin compromiso 💛",
    followUp: "¿Te lo aparto?",
  },
  {
    type: "comparison_solarium",
    triggers: ["solarium", "cama bronceadora", "cabina", "spray tan"],
    validate: "Buena comparación reina.",
    rebut:
      "Canelita te da el bronceado en casa, sin agendar cita ni exponerte a UV. Empieza a verse en 45 minutos, dura hasta 10 días y rinde para varias aplicaciones ✨",
    followUp: "",
  },
  {
    type: "duration",
    triggers: ["cuánto dura", "cuanto dura", "cuánto rinde", "cuanto rinde"],
    validate: "Te cuento.",
    rebut:
      "El color te dura hasta 10 días en la piel. Y una botella te rinde para varias aplicaciones (de ahí que la mayoría se lleva 2 unidades, les rinde unos 5 meses) 💛",
    followUp: "",
  },
  {
    type: "smell",
    triggers: ["huele feo", "huele mal", "qué olor", "que olor"],
    validate: "Súper buena pregunta.",
    rebut:
      "Canelita huele a coco/playa, súper rico. Nada del olor químico que tienen otros autobronceadores ✨",
    followUp: "",
  },
  {
    type: "skin_type",
    triggers: ["piel sensible", "piel mixta", "piel grasa", "piel seca"],
    validate: "Te entiendo, eso siempre se piensa.",
    rebut:
      "Canelita tiene colágeno, vitamina E y elastina, así que en lugar de resecarla la hidrata. Y al ser libre de parabenos es amable con pieles sensibles 💛",
    followUp: "",
  },
  {
    type: "is_original",
    triggers: [
      "es original",
      "será original",
      "sera original",
      "no es falsificación",
      "no es falsificacion",
      "es legítimo",
      "es legitimo",
    ],
    validate: "",
    rebut:
      "Sí mi reina, somos distribuidor autorizado de Canelita Hollywood ✨ El producto te llega sellado y con caja original. Si quieres te paso el sello de garantía.",
    followUp: "",
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
