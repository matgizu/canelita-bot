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
  | "shipping_cost"
  | "how_to_install"
  | "delivery_time"
  | "returns"
  | "colors"
  | "washing"
  | "capacity"
  | "brand_compatibility"
  | "tracking";

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
      "Son extensibles de 23 a 35 cm — caben en todas las neveras estándar de Colombia 🇨🇴, de 1 o 2 puertas. Y si al recibirlos no te caben, no pagas.",
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
      "Por eso es contraentrega: hoy no pagas nada. Te llega en 2-4 días hábiles y pagas al transportador cuando lo recibas — si te cae con tu quincena, mejor todavía.",
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
      "Si quieres te lo aparto 24 horas con tu nombre para que no se pierda el precio. Te escribo mañana sin compromiso.",
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
      "Estos cajones son diferentes — se cuelgan de la repisa y crean una repisa extra. El espacio que normalmente no usas queda aprovechado y todo visible de un vistazo.",
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
      "Son de plástico ABS alimentario libre de BPA — el mismo estándar de los tuppers de calidad. No transfiere olores ni sabores a los alimentos.",
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
    type: "how_to_install",
    triggers: [
      "cómo se pone",
      "como se pone",
      "cómo se instala",
      "como se instala",
      "cómo funciona",
      "como funciona",
      "cómo se usa",
      "como se usa",
      "cómo se engancha",
      "como se engancha",
      "cómo se coloca",
      "como se coloca",
      "es difícil ponerlo",
      "es dificil ponerlo",
    ],
    validate: "",
    rebut:
      "Fácil: estiras el cajón al ancho de tu repisa (23-35 cm), lo enganchas desde arriba en el borde inferior del estante, y listo. Sin tornillos ni pegamento. Para quitarlo solo lo levantas y deslizas.",
    followUp: "¿Lo pedimos?",
  },
  {
    type: "delivery_time",
    triggers: [
      "cuánto tarda",
      "cuanto tarda",
      "cuándo llega",
      "cuando llega",
      "días de entrega",
      "dias de entrega",
      "tiempo de entrega",
      "cuánto demora",
      "cuanto demora",
      "en cuánto llega",
      "en cuanto llega",
      "rápido llega",
      "rapido llega",
    ],
    validate: "",
    rebut:
      "2 a 4 días hábiles a cualquier ciudad de Colombia 🇨🇴 Bogotá, Medellín y Cali suelen llegar en 2 días. Y pagas cuando lo recibes, no antes.",
    followUp: "¿Lo pedimos hoy?",
  },
  {
    type: "returns",
    triggers: [
      "y si no me gusta",
      "y si no me sirve",
      "puedo devolverlo",
      "se puede devolver",
      "y si no funciona",
      "y si no es lo que esperaba",
      "política de devolución",
      "politica de devolucion",
      "y si llega malo",
      "garantía",
      "garantia",
    ],
    validate: "",
    rebut:
      "Por eso es contraentrega: cuando llegue el paquete, lo abres y revisas. Si no te convence no lo recibes y no pagas nada — el transportador se lo lleva de vuelta sin costo.",
    followUp: "Riesgo cero. ¿Lo mandamos?",
  },
  {
    type: "colors",
    triggers: [
      "qué colores",
      "que colores",
      "en qué colores",
      "en que colores",
      "color tiene",
      "puedo elegir color",
      "puedo escoger color",
      "de qué color",
      "de que color",
      "color viene",
    ],
    validate: "",
    rebut:
      "Vienen en blanco, verde menta y rosado — tonos suaves que quedan bonitos en cualquier nevera. Si no me indicas un color, te los enviamos blancos; y si los prefieres surtidos o de otro de los colores, también lo podemos hacer — solo me dices.",
    followUp: "¿Te mandamos el pack?",
  },
  {
    type: "washing",
    triggers: [
      "cómo se lava",
      "como se lava",
      "se puede lavar",
      "apto lavavajillas",
      "se puede meter al lavavajillas",
      "hay que lavar",
      "fácil de limpiar",
      "facil de limpiar",
    ],
    validate: "",
    rebut:
      "Con agua y jabón corriente o directo al lavavajillas — el plástico ABS aguanta sin problema y no absorbe olores ni manchas.",
    followUp: "¿Lo pedimos?",
  },
  {
    type: "capacity",
    triggers: [
      "cuánto aguanta",
      "cuanto aguanta",
      "cuánto carga",
      "cuanto carga",
      "peso máximo",
      "peso maximo",
      "se cae",
      "se va a caer",
      "aguanta mucho",
      "qué tan resistente es",
      "que tan resistente es",
    ],
    validate: "",
    rebut:
      "Aguanta sin problema el peso normal de frutas, verduras, quesos o sobrantes. El plástico ABS es resistente y el enganche en la repisa es firme.",
    followUp: "¿Lo probamos?",
  },
  {
    type: "brand_compatibility",
    triggers: [
      "samsung",
      "lg",
      "haceb",
      "mabe",
      "whirlpool",
      "challenger",
      "electrolux",
      "centrales",
      "frigidaire",
      "abba",
      "indurama",
      "nevera de dos puertas",
      "nevera de una puerta",
      "side by side",
    ],
    validate: "",
    rebut:
      "Sí, funciona en todas las neveras estándar: Samsung, LG, Haceb, Mabe, Whirlpool, Challenger — de 1 o 2 puertas. Son extensibles de 23 a 35 cm, solo necesitas que la repisa tenga borde inferior para el enganche.",
    followUp: "¿Lo pedimos?",
  },
  {
    type: "tracking",
    triggers: [
      "número de guía",
      "numero de guia",
      "puedo rastrear",
      "número de seguimiento",
      "numero de seguimiento",
      "cómo sé que va en camino",
      "como se que va en camino",
      "me avisan cuando sale",
      "transportadora",
    ],
    validate: "",
    rebut:
      "Sí, cuando despachamos te mandamos el número de guía por aquí mismo para que puedas rastrear el pedido en tiempo real 📦",
    followUp: "¿Lo pedimos?",
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
      "El envío es completamente gratis a toda Colombia 🇨🇴 Y pagas el producto cuando te lo entregue el transportador, no antes.",
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

const PHOTO_TRIGGERS = [
  "foto",
  "fotos",
  "imagen",
  "imagenes",
  "imágenes",
  "ver el producto",
  "cómo es",
  "como es",
  "cómo se ve",
  "como se ve",
  "cómo luce",
  "como luce",
  "mandame una foto",
  "mándame una foto",
  "muéstrame",
  "muestrame",
  "tienes fotos",
  "tienes foto",
  "hay fotos",
];

export function detectPhotoRequest(message: string): boolean {
  const q = norm(message);
  return PHOTO_TRIGGERS.some((t) => q.includes(norm(t)));
}

const VIDEO_TRIGGERS = [
  "video",
  // Cómo funciona / lo quiero ver funcionando
  "como funciona",
  "cómo funciona",
  "ver como funciona",
  "ver cómo funciona",
  "lo quiero ver funcionar",
  "ver funcionando",
  "como sirve",
  "para que sirve",
  // Cómo se pone / instala / usa
  "como se pone",
  "como se instala",
  "como se coloca",
  "como se usa",
  "como se arma",
  "como se monta",
  "como se engancha",
  "como lo pongo",
  "como lo instalo",
  "como lo coloco",
  "como se acomoda",
  "como se ajusta",
  // No le queda claro / no entiende
  "no me queda claro",
  "no me quedo claro",
  "no me queda muy claro",
  "no entiendo como",
  "no entendi como",
  "no entiendo bien",
  "no me queda claro como",
  "como es eso",
  "no se como es",
  "no entiendo como es",
];

export function detectVideoRequest(message: string): boolean {
  const q = norm(message);
  return VIDEO_TRIGGERS.some((t) => q.includes(norm(t)));
}
