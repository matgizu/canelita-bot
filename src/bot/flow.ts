export type State =
  | "GREETING"
  | "INTEREST"
  | "QUANTITY"
  | "OBJECTION_HANDLING"
  | "CONFIRM_ORDER"
  | "ADDRESS_COLLECTION"
  | "PAYMENT_METHOD"
  | "CLOSED";

export const STATES: State[] = [
  "GREETING",
  "INTEREST",
  "QUANTITY",
  "OBJECTION_HANDLING",
  "CONFIRM_ORDER",
  "ADDRESS_COLLECTION",
  "PAYMENT_METHOD",
  "CLOSED",
];

export const TRANSITIONS: Record<State, State[]> = {
  GREETING:          ["INTEREST", "QUANTITY", "OBJECTION_HANDLING"],
  INTEREST:          ["QUANTITY", "OBJECTION_HANDLING"],
  QUANTITY:          ["CONFIRM_ORDER", "OBJECTION_HANDLING"],
  OBJECTION_HANDLING:["GREETING", "INTEREST", "QUANTITY", "CONFIRM_ORDER"],
  CONFIRM_ORDER:     ["ADDRESS_COLLECTION", "OBJECTION_HANDLING"],
  ADDRESS_COLLECTION:["PAYMENT_METHOD", "OBJECTION_HANDLING"],
  PAYMENT_METHOD:    ["CLOSED", "OBJECTION_HANDLING"],
  CLOSED:            ["CLOSED"],
};

export function isValidTransition(from: State, to: State): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const HARDCODED_GREETING = `¡Hola! Soy Valentina de FreskaBox.

Los cajones se enganchan bajo la repisa de tu nevera en 5 segundos — sin herramientas, sin pegamento. Extensibles y aptos para cualquier nevera estándar.

📦 Pack x3 — 3 cajones para 3 repisas: $69.900 ($23.300 c/u)
📦 Pack x6 — nevera completa (6 cajones): $119.900 ($19.900 c/u)

Los dos con envío gratis y pagas cuando lo recibes.

¿A qué ciudad te lo enviamos? El envío es totalmente gratis 🇨🇴

¿Tienes alguna pregunta o arrancamos con el pedido?`;

export const HARDCODED_GREETING_JSON = JSON.stringify({
  message: HARDCODED_GREETING,
  state: "GREETING",
  cartUpdate: null,
});

export const REMARKETING_MESSAGES = {
  t1: `¿Pudiste ver bien los cajones? 💛\n\nMira cómo queda la nevera con el pack de 3: cada repisa organizada, todo visible, nada más mezclándose.\n\nEnvío GRATIS a toda Colombia y pagas solo cuando lo recibes ✨\n\n¿Te lo mandamos hoy?`,
  t2: `Hola de nuevo ✨ Los cajones siguen disponibles con envío gratis y contraentrega — sin riesgo.\n\nLas personas que los prueban vuelven a pedir el pack de 6 para completar la nevera. ¿Le damos?`,
  t3: `Buenos días ☀️ Hoy tenemos despachos y quería saber si ya te decidiste con los cajones.\n\nSi lo cerramos hoy mismo sale en camino. ¿Qué me dices?`,
  t4: `Última cosita 💛 Hoy es el último día que te puedo aplicar el precio especial del pack de 3.\n\n¿Lo llevamos o lo dejamos para después?`,
};

// Helper: ms until colHour:00 on the next COL calendar day (COL = UTC-5, no DST).
// Correctly handles sessions created late at night COL time.
export function msUntilNextDayColTime(fromMs: number, colHour: number): number {
  // Shift fromMs back 5h to get the "COL clock date" as if it were UTC
  const colDate = new Date(fromMs - 5 * 60 * 60 * 1000);
  // Next COL calendar day at colHour:00 COL = (colHour+5):00 UTC
  // Date.UTC handles colHour+5 > 23 by rolling over to the next UTC day — correct behaviour
  const target = Date.UTC(
    colDate.getUTCFullYear(),
    colDate.getUTCMonth(),
    colDate.getUTCDate() + 1,
    colHour + 5,
    0, 0, 0,
  );
  return target - fromMs;
}

export const TIMING = {
  debounceMs: 30_000,
  greetingExtraDelayMs: 3_000,
  defaultExtraDelayMs: 20_000,
  perPartBaseMs: 600,
  perPartPerWordMs: 35,
  perPartMaxMs: 4_000,
};

export interface CartItem {
  variant: "pack3" | "pack6";
  quantity: number;
}

export interface Session {
  waId: string;
  state: State;
  cart: CartItem[];
  customerName?: string;
  fullName?: string;
  phone?: string;
  altPhone?: string;
  idNumber?: string;
  email?: string;
  adSource?: string;
  adHeadline?: string;
  ctwaClid?: string;
  address?: string;
  reference?: string;
  city?: string;
  department?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pendingOrder?: {
    cart: CartItem[];
    paymentMethod?: "cod" | "prepaid";
    total?: number;
  };
  automationEnabled: boolean;
  objectionCount: number;
  lastInboundAt: number;
  lastOutboundAt: number;
  createdAt: number;
}

export function newSession(waId: string): Session {
  const now = Date.now();
  return {
    waId,
    state: "GREETING",
    cart: [],
    history: [],
    automationEnabled: true,
    objectionCount: 0,
    lastInboundAt: now,
    lastOutboundAt: now,
    createdAt: now,
  };
}

export function pushHistory(
  session: Session,
  role: "user" | "assistant",
  content: string,
): void {
  session.history.push({ role, content });
  while (session.history.length > 16) session.history.shift();
}
