import { TIMING } from "./flow";

interface Pending {
  parts: string[];
  firstAt: number;
  timer: NodeJS.Timeout;
  hasImage: boolean;
  imageMediaId?: string;
}

type Flush = (combinedText: string, hasImage: boolean, imageMediaId?: string) => void;

const pending = new Map<string, Pending>();

const GREETING_RE =
  /^(hola+|holi+|buenas|buen[oa]s? (d[ií]as|tardes|noches)|qhubo|q hubo|que tal|saludos|hello|hi)\b/i;

function isGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (GREETING_RE.test(t)) return true;
  return t.length < 12 && /[a-zñáéíóú]/i.test(t) && !/[?]/.test(t);
}

export function enqueueInbound(
  waId: string,
  text: string,
  flush: Flush,
  opts: { hasImage?: boolean; imageMediaId?: string } = {},
): void {
  let p = pending.get(waId);

  if (!p) {
    p = {
      parts: [],
      firstAt: Date.now(),
      timer: setTimeout(() => {}, 0),
      hasImage: false,
    };
    pending.set(waId, p);
  } else {
    clearTimeout(p.timer);
  }

  if (text) p.parts.push(text);
  if (opts.hasImage) {
    p.hasImage = true;
    if (opts.imageMediaId) p.imageMediaId = opts.imageMediaId;
  }

  p.timer = setTimeout(async () => {
    const current = pending.get(waId);
    if (!current) return;
    pending.delete(waId);
    const combined = current.parts.join("\n").trim();
    const greeting = isGreeting(combined);
    const extraDelay = greeting
      ? TIMING.greetingExtraDelayMs
      : TIMING.defaultExtraDelayMs;
    setTimeout(
      () => flush(combined, current.hasImage, current.imageMediaId),
      extraDelay,
    );
  }, TIMING.debounceMs);
}

export function clearPending(waId: string): void {
  const p = pending.get(waId);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(waId);
  }
}
