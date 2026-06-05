/* eslint-disable no-console */
import "dotenv/config";

// Estas asignaciones deben ir ANTES de los imports que cargan config.ts.
// Con TypeScript los `import` estáticos se izan (hoisting), así que
// usamos `import()` dinámico más abajo para los módulos que dependen de config.
process.env.WHATSAPP_TOKEN ||= "sim";
process.env.WHATSAPP_PHONE_NUMBER_ID ||= "sim";
process.env.META_APP_SECRET ||= "sim";
process.env.META_VERIFY_TOKEN ||= "sim";
process.env.DATABASE_URL ||= "postgresql://sim:sim@localhost:5432/sim";

import readline from "node:readline";

// Solo importamos los módulos que NO dependen de config.ts de forma estática
import {
  type Session,
  HARDCODED_GREETING,
  HARDCODED_GREETING_JSON,
  isValidTransition,
  newSession,
  pushHistory,
} from "../src/bot/flow";
import { sanitizeOutput } from "../src/bot/blocklist";
import {
  HARD_OBJECTION_THRESHOLD,
  buildObjectionResponse,
  detectObjection,
} from "../src/bot/objections";
import { detectSpecialCase } from "../src/bot/specialCases";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const printSofia = (text: string) =>
  console.log(`${C.magenta}Valentina${C.reset} ${text}`);
const printMeta = (text: string) =>
  console.log(`${C.dim}${text}${C.reset}`);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno o en .env");
    process.exit(1);
  }

  // Importación dinámica: se resuelve DESPUÉS de que los env vars están listos
  const { askClaude } = await import("../src/claude/client");

  const session: Session = newSession("sim_user");
  printMeta("Simulador FreskaBox — escribe 'salir' para terminar.");
  printMeta(`Estado inicial: ${session.state}`);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    new Promise<string>((resolve) =>
      rl.question(`${C.cyan}Tú${C.reset} `, (a) => resolve(a)),
    );

  while (true) {
    const userInput = (await ask()).trim();
    if (!userInput) continue;
    if (/^(salir|exit|quit)$/i.test(userInput)) break;

    session.lastInboundAt = Date.now();

    // Primer mensaje: saludo hardcodeado, sin pasar por Claude
    if (session.history.length === 0 && session.state === "GREETING") {
      printSofia(sanitizeOutput(HARDCODED_GREETING));
      pushHistory(session, "user", userInput);
      pushHistory(session, "assistant", HARDCODED_GREETING_JSON);
      continue;
    }

    const special = detectSpecialCase({ text: userInput, hasImage: false, state: session.state });
    if (special) {
      printSofia(sanitizeOutput(special.response));
      pushHistory(session, "user", userInput);
      pushHistory(session, "assistant", JSON.stringify({ message: special.response, state: session.state, cartUpdate: null }));
      printMeta(`[caso especial: ${special.type}]`);
      if (special.disableBot) {
        printMeta("[bot desactivado — fin de simulación]");
        break;
      }
      continue;
    }

    pushHistory(session, "user", userInput);

    const objection = detectObjection(userInput);
    let claudeText: string;
    let nextState = session.state;
    let cartUpdate = null;

    if (objection && session.state !== "GREETING") {
      session.objectionCount += 1;
      claudeText = buildObjectionResponse(objection);
      nextState = "OBJECTION_HANDLING";
      printMeta(`[objeción detectada: ${objection.type} (#${session.objectionCount})]`);
      if (session.objectionCount >= HARD_OBJECTION_THRESHOLD) {
        printMeta("[⚠ objeción dura — en producción notificaría Telegram]");
      }
    } else {
      const reply = await askClaude(session, userInput);
      claudeText = reply.message;
      nextState = isValidTransition(session.state, reply.state) ? reply.state : session.state;
      cartUpdate = reply.cartUpdate;
    }

    const sanitized = sanitizeOutput(claudeText);
    if (cartUpdate) session.cart = cartUpdate;
    if (nextState !== session.state) {
      printMeta(`[transición: ${session.state} → ${nextState}]`);
      session.state = nextState;
    }

    printSofia(sanitized);
    pushHistory(session, "assistant", JSON.stringify({ message: sanitized, state: nextState, cartUpdate }));

    if (session.cart.length) {
      printMeta(`[carrito: ${session.cart.map((c) => `${c.quantity}x ${c.variant}`).join(", ")}]`);
    }

    if (nextState === "CLOSED") {
      printMeta("[pedido cerrado — fin de simulación]");
      break;
    }
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
