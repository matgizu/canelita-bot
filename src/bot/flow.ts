export type State =
  | "GREETING"
  | "INTEREST"
  | "VARIANT_SELECTION"
  | "QUANTITY"
  | "OBJECTION_HANDLING"
  | "CONFIRM_ORDER"
  | "ADDRESS_COLLECTION"
  | "PAYMENT_METHOD"
  | "CLOSED";

export const STATES: State[] = [
  "GREETING",
  "INTEREST",
  "VARIANT_SELECTION",
  "QUANTITY",
  "OBJECTION_HANDLING",
  "CONFIRM_ORDER",
  "ADDRESS_COLLECTION",
  "PAYMENT_METHOD",
  "CLOSED",
];

export const TRANSITIONS: Record<State, State[]> = {
  GREETING: ["INTEREST", "VARIANT_SELECTION", "OBJECTION_HANDLING"],
  INTEREST: ["VARIANT_SELECTION", "OBJECTION_HANDLING", "QUANTITY"],
  VARIANT_SELECTION: ["QUANTITY", "OBJECTION_HANDLING"],
  QUANTITY: ["CONFIRM_ORDER", "OBJECTION_HANDLING"],
  OBJECTION_HANDLING: [
    "GREETING",
    "INTEREST",
    "VARIANT_SELECTION",
    "QUANTITY",
    "CONFIRM_ORDER",
  ],
  CONFIRM_ORDER: ["ADDRESS_COLLECTION", "OBJECTION_HANDLING"],
  ADDRESS_COLLECTION: ["PAYMENT_METHOD", "OBJECTION_HANDLING"],
  PAYMENT_METHOD: ["CLOSED", "OBJECTION_HANDLING"],
  CLOSED: ["CLOSED"],
};

export function isValidTransition(from: State, to: State): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const HARDCODED_GREETING = `¡Hola reina! 🌴 Soy Sofía de Canelita Hollywood.

▎ Vi que te interesó el autobronceador — cuéntame, ¿buscas un tono natural o algo más intenso? 🤎`;

export const HARDCODED_GREETING_JSON = JSON.stringify({
  message: HARDCODED_GREETING,
  state: "GREETING",
  cartUpdate: null,
});

export const REMARKETING_MESSAGES = {
  t1: `Reina, ¿pudiste ver bien la info? 💛\n\nMira los resultados que están teniendo nuestras clientas con Canelita... el bronceado queda natural y divino.\n\nRecuerda: envío GRATIS a toda Colombia y pagas solo cuando lo recibes. Sin riesgo ✨\n\n¿Te lo mandamos hoy?`,
  t2: `Hola de nuevo ✨ Te cuento que el autobronceador sigue disponible con envío gratis y pagas al recibirlo — sin riesgo.\n\nLa mayoría que lo prueba repite. ¿Le damos?`,
  t3: `Buenos días reina ☀️ Hoy tenemos despachos y quería saber si ya te decidiste.\n\nSi lo cerramos hoy mismo sale en camino. ¿Qué me dices?`,
  t4: `Última cosita reina 💛 Hoy es el último día que te puedo aplicar el precio especial.\n\n¿Lo llevamos o lo dejamos para después?`,
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
  variant: "natural" | "intenso";
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
