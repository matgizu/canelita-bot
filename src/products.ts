export type VariantId = "natural" | "intenso";

export interface Variant {
  id: VariantId;
  name: string;
  shortName: string;
  recommendedFor: string;
}

export const VARIANTS: Record<VariantId, Variant> = {
  natural: {
    id: "natural",
    name: "Canelita Hollywood Color Natural",
    shortName: "Natural",
    recommendedFor:
      "pieles claras o que quieren un bronceado sutil y progresivo",
  },
  intenso: {
    id: "intenso",
    name: "Canelita Hollywood Color Intenso",
    shortName: "Intenso",
    recommendedFor:
      "pieles trigueñas/morenas o que buscan un bronceado más marcado desde la primera aplicación",
  },
};

export interface Combo {
  units: 1 | 2 | 3;
  price: number;
  savings: number;
  label: string;
  pitch: string;
}

const PRICE_UNIT = Number(process.env.PRICE_UNIT ?? 69900);
const PRICE_2X = Number(process.env.PRICE_2X ?? 119900);
const PRICE_3X = Number(process.env.PRICE_3X ?? 159900);
const PREPAID_DISCOUNT = 5000;

export const COMBOS: Combo[] = [
  {
    units: 1,
    price: PRICE_UNIT,
    savings: 0,
    label: "1 unidad",
    pitch: "ideal si es tu primera vez probándolo",
  },
  {
    units: 2,
    price: PRICE_2X,
    savings: PRICE_UNIT * 2 - PRICE_2X,
    label: "2 unidades",
    pitch:
      "el más popular: rinde para unos 5 meses y ahorras casi $20.000",
  },
  {
    units: 3,
    price: PRICE_3X,
    savings: PRICE_UNIT * 3 - PRICE_3X,
    label: "3 unidades",
    pitch: "el de mayor ahorro, ideal para compartir con amigas o hermanas",
  },
];

export const PREPAID = {
  discount: PREPAID_DISCOUNT,
  methods: {
    nequi: process.env.NEQUI_NUMBER ?? "",
    bancolombia: process.env.BANCOLOMBIA_ACCOUNT ?? "",
    daviplata: process.env.DAVIPLATA_NUMBER ?? "",
  },
};

export const PRODUCT_INFO = {
  name: "Autobronceador Canelita Hollywood",
  size: "90 ml / 3.0 fl oz",
  presentation: "Botella con dosificador spray + caja exterior",
  ingredients: [
    "DHA (dihidroxiacetona, derivado de caña de azúcar)",
    "Colágeno",
    "Vitamina E",
    "Caña de azúcar",
    "Aminoácidos de coco natural",
    "Elastina",
  ],
  freeOf: ["parabenos", "colorantes artificiales"],
  benefits: [
    "Bronceado sin sol — sin riesgo de manchas ni envejecimiento",
    "Dura hasta 10 días en la piel",
    "Color visible en 45 minutos, se intensifica al día siguiente",
    "No se cae con el agua",
    "No mancha ropa ni sábanas (después de secar)",
    "Disimula venitas, estrías, celulitis, cicatrices y manchas",
    "Aroma agradable a coco/playa",
    "Hidrata y aporta luminosidad",
    "Logra tono uniforme",
  ],
  application: [
    "Piel limpia, seca y exfoliada",
    "Aplicar uniformemente con movimientos circulares",
    "Dejar secar 10 minutos antes de vestirse",
    "Lavarse muy bien las manos después",
    "No mojar la piel hasta el día siguiente",
    "Mantenimiento: una capa cada semana",
  ],
  limitations: [
    "No aplicar en la cara (zona muy sensible)",
    "Consultar con profesional si está en depilación láser",
    "Para retirar rápido: bicarbonato + limón, o aceite de oliva/coco",
  ],
};

export function findCombo(units: number): Combo | undefined {
  return COMBOS.find((c) => c.units === units);
}

export function comboSummary(units: 1 | 2 | 3, prepaid = false): string {
  const combo = findCombo(units)!;
  const total = prepaid ? combo.price - PREPAID_DISCOUNT : combo.price;
  return `${combo.label} — $${total.toLocaleString("es-CO")} COP (envío gratis)`;
}

export function formatCOP(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}
