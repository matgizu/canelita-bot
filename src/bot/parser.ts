import { State, STATES } from "./flow";
import type { CartItem } from "./flow";

export interface ClaudeReply {
  message: string;
  state: State;
  cartUpdate: CartItem[] | null;
}

const VALID_STATES = new Set(STATES);

function isValidState(s: unknown): s is State {
  return typeof s === "string" && VALID_STATES.has(s as State);
}

function normalizeCartUpdate(raw: unknown): CartItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: CartItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const v = (it as any).variant;
    const q = Number((it as any).quantity);
    if ((v === "natural" || v === "intenso") && Number.isFinite(q) && q > 0) {
      items.push({ variant: v, quantity: Math.floor(q) });
    }
  }
  return items.length ? items : null;
}

export function parseClaudeReply(
  raw: string,
  fallbackState: State,
): ClaudeReply {
  const cleaned = raw.trim();

  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct.message === "string") {
      return {
        message: direct.message,
        state: isValidState(direct.state) ? direct.state : fallbackState,
        cartUpdate: normalizeCartUpdate(direct.cartUpdate),
      };
    }
  } catch {}

  const block = extractJsonBlock(cleaned);
  if (block) {
    try {
      const parsed = JSON.parse(block);
      if (parsed && typeof parsed.message === "string") {
        return {
          message: parsed.message,
          state: isValidState(parsed.state) ? parsed.state : fallbackState,
          cartUpdate: normalizeCartUpdate(parsed.cartUpdate),
        };
      }
    } catch {}
  }

  const messageMatch = cleaned.match(
    /"message"\s*:\s*"((?:\\.|[^"\\])*)"/,
  );
  const stateMatch = cleaned.match(/"state"\s*:\s*"([A-Z_]+)"/);
  if (messageMatch) {
    const decoded = decodeJsonString(messageMatch[1]);
    return {
      message: decoded,
      state:
        stateMatch && isValidState(stateMatch[1])
          ? (stateMatch[1] as State)
          : fallbackState,
      cartUpdate: null,
    };
  }

  const patternMatch = cleaned.match(/"((?:\\.|[^"\\])+)"\s*,\s*"state"/);
  if (patternMatch) {
    return {
      message: decodeJsonString(patternMatch[1]),
      state: fallbackState,
      cartUpdate: null,
    };
  }

  return {
    message: cleaned.replace(/[`{}[\]]/g, "").trim() || "Cuéntame más reina 💛",
    state: fallbackState,
    cartUpdate: null,
  };
}

function extractJsonBlock(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function decodeJsonString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\t/g, "\t");
}
