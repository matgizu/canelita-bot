export type VariantId = "pack3" | "pack6";

export interface Combo {
  id: VariantId;
  units: number;
  price: number;
  savings: number;
  label: string;
  pitch: string;
}

const PRICE_PACK3 = Number(process.env.PRICE_PACK3 ?? 69900);
const PRICE_PACK6 = Number(process.env.PRICE_PACK6 ?? 119900);
const PREPAID_DISCOUNT = 5000;

export const COMBOS: Combo[] = [
  {
    id: "pack3",
    units: 3,
    price: PRICE_PACK3,
    savings: 0,
    label: "Pack x3",
    pitch: "ideal para organizar 3 repisas y ver el cambio de inmediato",
  },
  {
    id: "pack6",
    units: 6,
    price: PRICE_PACK6,
    savings: PRICE_PACK3 * 2 - PRICE_PACK6,
    label: "Pack x6 (nevera completa)",
    pitch: "el más popular: surte toda la nevera y ahorras $19.900",
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
  name: "Cajón Organizador Extensible FreskaBox",
  presentation: "Cajón retráctil que se engancha en la repisa de la nevera",
  materials: ["Plástico ABS alimentario libre de BPA", "Apto lavavajillas"],
  dimensions: "Extensible de 23 cm a 35 cm — cabe en neveras estándar de 1 o 2 puertas",
  colors: ["Beige", "Verde menta", "Amarillo pastel"],
  benefits: [
    "Organiza frutas, verduras y sobrantes sin que todo se mezcle",
    "Crea una repisa extra aprovechando el espacio vertical de la nevera",
    "Extensible: se adapta al ancho de cualquier repisa sin herramientas",
    "Se engancha en 5 segundos — sin tornillos, sin instalación",
    "Fácil de lavar — apto lavavajillas y bajo el grifo",
    "Plástico ABS sin BPA — sin olores ni sabores transferidos a los alimentos",
    "Todo visible de un vistazo — se acaba el buscar cosas perdidas",
    "Colores pastel que hacen la nevera verse bonita y ordenada",
  ],
  installation: [
    "Extiende el cajón al ancho de tu repisa (23–35 cm)",
    "Engánchalo desde arriba en el borde de la repisa",
    "Listo en 5 segundos — sin tornillos, sin herramientas",
    "Para quitar: levanta levemente y desliza hacia afuera",
  ],
};

export function findCombo(id: string): Combo | undefined {
  return COMBOS.find((c) => c.id === id);
}

export function comboSummary(id: VariantId, prepaid = false): string {
  const combo = findCombo(id)!;
  const total = prepaid ? combo.price - PREPAID_DISCOUNT : combo.price;
  return `${combo.label} (${combo.units} cajones) — $${total.toLocaleString("es-CO")} COP (envío gratis)`;
}

export function formatCOP(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}
