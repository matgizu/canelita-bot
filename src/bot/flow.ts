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

Canelita es un autobronceador corporal que te broncea SIN sol, sin playa y sin camas bronceadoras.

✔ El color se ve en 45 min y te dura hasta 10 días
✔ No se cae con el agua
✔ Disimula venitas, estrías y celulitis
✔ Hidrata tu piel y huele a coco 💛
✔ Libre de parabenos y colorantes

Viene en 2 tonos: *Natural* (pieles claras) e *Intenso* (pieles trigueñas).

Una unidad: $69.900 con envío GRATIS a toda Colombia.
Pagas cuando lo recibes, sin anticipos.

¿Lo viste para ti o para regalar?`;

export const HARDCODED_GREETING_JSON = JSON.stringify({
  message: HARDCODED_GREETING,
  state: "GREETING",
  cartUpdate: null,
});

export const REMARKETING_MESSAGES = {
  confirmOrder30min: `¿Sigues por ahí reina? 💛 Te dejé tu pedido apartado, cuando quieras lo confirmamos y te lo despachamos hoy mismo.`,
  addressCollection1h: `Hola de nuevo ✨ Vi que quedamos a mitad del pedido. Si tienes los datos a mano lo cerramos en 1 minuto y queda en camino.`,
  paymentMethod2h: `Hola reina, solo nos falta el último pasito para cerrar tu pedido. Si lo dejamos para mañana ya no alcanzo a despachar hoy 💛`,
  recovery24h: `¡Hola otra vez! 💛 Te quería contar que como cariñito por volver te puedo aplicar un descuento de bienvenida solo por hoy. ¿Te animas a llevarlo?`,
};

export const REMARKETING_DELAYS = {
  confirmOrder: 30 * 60 * 1000,
  addressCollection: 60 * 60 * 1000,
  paymentMethod: 2 * 60 * 60 * 1000,
  recovery: 24 * 60 * 60 * 1000,
};

export const TIMING = {
  debounceMs: 10_000,
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
