export const BLOCKLIST_PHRASES: string[] = [
  "compre ya",
  "compra ya",
  "no se lo pierda",
  "no te lo pierdas",
  "oferta del día",
  "oferta del dia",
  "estimada cliente",
  "estimado cliente",
  "señorita",
  "doña",
  "dona ",
  "quedamos atentos",
  "cordialmente",
  "atentamente",
  "producto milagroso",
  "garantizado al 100",
  "garantizado al cien",
  "elimina la celulitis",
  "elimina las estrías",
  "elimina las estrias",
  "elimina celulitis",
  "como ya te dije",
  "te repito",
  "ya te expliqué",
  "ya te explique",
  "es muy fácil",
  "es muy facil",
  "es obvio",
  "manchas",
  "tinta",
  "se ve falso",
];

const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS = BLOCKLIST_PHRASES.map(
  (p) => new RegExp(escapeRegex(p), "gi"),
);

export function containsBlocked(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < BLOCKLIST_PHRASES.length; i++) {
    if (PATTERNS[i].test(text)) found.push(BLOCKLIST_PHRASES[i]);
  }
  return found;
}

export function sanitizeOutput(text: string): string {
  let out = text;

  for (const p of PATTERNS) {
    out = out.replace(p, "");
  }

  out = out.replace(/!{2,}/g, "!");

  out = out.replace(/[A-ZÁÉÍÓÚÑ]{4,}/g, (match) => {
    const allCaps = match === match.toUpperCase();
    return allCaps ? match.charAt(0) + match.slice(1).toLowerCase() : match;
  });

  out = limitEmojis(out, 2);

  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

function limitEmojis(text: string, maxPerMessage: number): string {
  const emojiRegex =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu;
  let count = 0;
  return text.replace(emojiRegex, (m) => {
    count += 1;
    return count <= maxPerMessage ? m : "";
  });
}
