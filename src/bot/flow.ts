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

// Order of the "happy path" funnel, excluding OBJECTION_HANDLING (which can be
// reached from — and return to — any of these states).
const FUNNEL_ORDER: State[] = [
  "GREETING",
  "INTEREST",
  "QUANTITY",
  "CONFIRM_ORDER",
  "ADDRESS_COLLECTION",
  "PAYMENT_METHOD",
  "CLOSED",
];

// A real conversation regularly compresses steps (e.g. a customer who states
// the quantity and confirms the order in the same message never produces an
// explicit QUANTITY reply). If we only allowed the exact next funnel state,
// the stored state gets stuck behind where the conversation actually is and
// never reaches CLOSED — losing the order and the sale from tracking. Allowing
// a one-step skip absorbs that without opening the door to premature CLOSED
// transitions that would skip required data collection (address, payment).
const MAX_FUNNEL_SKIP = 2;

export function isValidTransition(from: State, to: State): boolean {
  if (from === to) return true;
  if (from === "CLOSED") return false;

  if (to === "OBJECTION_HANDLING") return true;
  if (from === "OBJECTION_HANDLING") return TRANSITIONS.OBJECTION_HANDLING.includes(to);

  const fromIdx = FUNNEL_ORDER.indexOf(from);
  const toIdx = FUNNEL_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx <= fromIdx) return false;
  return toIdx - fromIdx <= MAX_FUNNEL_SKIP;
}

export const HARDCODED_GREETING = `¡Hola! Soy Valentina de FreskaBox 🌿

Dime una cosa: ¿te pasa que abres la nevera y las cosas están todas amontonadas o se pierden en el fondo?

Eso es exactamente lo que resuelven estos cajones — se enganchan bajo cada repisa en 5 segundos, sin tornillos ni pegamento, y crean un espacio extra que normalmente no usas.

📦 Pack x3 — 3 cajones: $69.900 (te sale a $23.300 cada uno)
📦 Pack x6 — nevera completa: $119.900 (te sale a $19.900 cada uno)

Los dos tienen envío gratis a toda Colombia 🇨🇴 y pagas cuando lo recibes — sin riesgo.

¿Cuántas repisas tiene tu nevera? Así te digo cuál pack te conviene más.`;

export const HARDCODED_GREETING_JSON = JSON.stringify({
  message: HARDCODED_GREETING,
  state: "GREETING",
  cartUpdate: null,
});

export const REMARKETING_MESSAGES = {
  t1: `¿Pudiste ver bien los cajones FreskaBox?\n\nCada uno se engancha bajo la repisa de tu nevera en 5 segundos — sin herramientas. El pack x3 organiza 3 repisas completas por $69.900.\n\nEnvío gratis a toda Colombia 🇨🇴 y pagas cuando lo recibes.\n\n¿Te lo mandamos hoy?`,
  t2: `Hola de nuevo. Los cajones FreskaBox siguen disponibles con envío gratis y contraentrega — sin riesgo.\n\nQuien prueba el pack x3 casi siempre vuelve por el x6 para completar la nevera. ¿Arrancamos?\n\nPack x3: $69.900 · Pack x6: $119.900`,
  t3: `Buenos días ☀️ Solo hoy te puedo aplicar un descuento de $10.000 en tu pedido FreskaBox.\n\nPack x3 → $59.900 (antes $69.900)\nPack x6 → $109.900 (antes $119.900)\n\nEnvío gratis y pagas cuando lo recibes 🇨🇴 ¿Lo cerramos hoy?`,
  t4: `Última vez que te escribo. Los cajones FreskaBox tienen envío gratis y pagas contraentrega — sin riesgo de tu parte.\n\nPack x3 por $69.900 o nevera completa con el x6 por $119.900.\n\n¿Lo llevamos o lo dejamos?`,
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
  discountOffered?: boolean;
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
