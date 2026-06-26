import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { anthropicHttpsAgent } from "./httpAgent";
import { getConfig } from "../botConfig";
import { CLAUDE_PARAMS, buildContextHint, buildSystemPrompt, ContextHints } from "../bot/prompts";
import { ClaudeReply, parseClaudeReply } from "../bot/parser";
import type { Session } from "../bot/flow";

// maxRetries: el SDK reintenta con backoff exponencial + jitter ante errores de
// conexión (incluido "Premature close", cuando el socket se cierra antes de la
// respuesta) y 408/409/429/5xx. timeout amplio para respuestas largas.
const client = new Anthropic({
  apiKey: config.anthropic.apiKey,
  maxRetries: 4,
  timeout: 60_000,
  httpAgent: anthropicHttpsAgent,
});

export async function askClaude(
  session: Session,
  userMessage: string,
): Promise<ClaudeReply> {
  const cfg = await getConfig();

  const hint: ContextHints = {
    state: session.state,
    customerName: session.customerName,
    city: session.city,
    department: session.department,
    cartSummary: cartSummary(session),
    discountActive: session.discountOffered,
    objectionCount: session.objectionCount,
    collectedFields: {
      fullName:  session.fullName,
      idNumber:  session.idNumber,
      email:     session.email,
      address:   session.address,
      reference: session.reference,
      altPhone:  session.altPhone,
    },
  };

  const messages: Anthropic.MessageParam[] = [];

  // Solo metemos turnos con contenido real. La API rechaza con 400 cualquier
  // turno de contenido vacío/espacios, y un único turno vacío en el historial
  // tumbaba TODA la conversación a partir de ahí. Filtrar aquí además hace que
  // las conversaciones ya corruptas se auto-recuperen en el siguiente mensaje.
  for (const turn of session.history) {
    if (typeof turn.content === "string" && turn.content.trim()) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  const appended = `${buildContextHint(hint)}\n\nMENSAJE DEL CLIENTE:\n${userMessage}`.trim();
  if (!appended) {
    // No hay nada que enviar (mensaje del cliente vacío). No llamamos a la API.
    return { message: "", state: session.state, cartUpdate: null, fields: null, reminder: null, error: true };
  }
  messages.push({ role: "user", content: appended });

  // El SDK ya reintenta internamente (maxRetries) los errores de conexión; este
  // bucle externo es la última red de seguridad antes de quedarnos callados.
  const MAX_ATTEMPTS = 2;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await client.messages.create({
        model: CLAUDE_PARAMS.model,
        max_tokens: CLAUDE_PARAMS.max_tokens,
        temperature: CLAUDE_PARAMS.temperature,
        system: buildSystemPrompt(cfg, session.strategy ?? "A"),
        messages,
      });

      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("\n")
        .trim();

      return parseClaudeReply(text, session.state);
    } catch (e: any) {
      lastErr = e;
      const status: number | undefined = e?.status;
      // 400 = petición malformada (no se arregla reintentando). Para todo lo
      // demás (429, 5xx, 529 overloaded, red) reintentamos con backoff corto.
      const retryable = status === undefined || status === 429 || status >= 500;
      console.error(`[claude.askClaude] intento ${attempt}/${MAX_ATTEMPTS} status=${status ?? "net"}: ${e?.message}`);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, attempt * 700));
    }
  }

  // No respondemos nada fuera de marca al cliente. Señalamos error para que
  // el handler se quede callado y avise al dueño para intervención manual.
  void lastErr;
  return {
    message: "",
    state: session.state,
    cartUpdate: null,
    fields: null,
    reminder: null,
    error: true,
  };
}

function cartSummary(session: Session): string | undefined {
  if (!session.cart.length) return undefined;
  return session.cart
    .map((c) => `${c.quantity}x ${c.variant}`)
    .join(", ");
}
