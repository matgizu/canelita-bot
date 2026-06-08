import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { CLAUDE_PARAMS, buildContextHint, buildSystemPrompt, ContextHints } from "../bot/prompts";
import { ClaudeReply, parseClaudeReply } from "../bot/parser";
import type { Session } from "../bot/flow";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = buildSystemPrompt();

export async function askClaude(
  session: Session,
  userMessage: string,
): Promise<ClaudeReply> {
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

  for (const turn of session.history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({
    role: "user",
    content: `${buildContextHint(hint)}\n\nMENSAJE DEL CLIENTE:\n${userMessage}`,
  });

  try {
    const res = await client.messages.create({
      model: CLAUDE_PARAMS.model,
      max_tokens: CLAUDE_PARAMS.max_tokens,
      temperature: CLAUDE_PARAMS.temperature,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n")
      .trim();

    return parseClaudeReply(text, session.state);
  } catch (e: any) {
    console.error("[claude.askClaude]", e.message);
    return {
      message:
        "Ay reina, se me complicó un segundito acá 💛 ¿Me repites lo último?",
      state: session.state,
      cartUpdate: null,
      fields: null,
      reminder: null,
    };
  }
}

function cartSummary(session: Session): string | undefined {
  if (!session.cart.length) return undefined;
  return session.cart
    .map((c) => `${c.quantity}x ${c.variant}`)
    .join(", ");
}
