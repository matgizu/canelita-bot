import { Router } from "express";
import { askClaude } from "../claude/client";
import { sanitizeOutput } from "../bot/blocklist";
import {
  HARDCODED_GREETING,
  HARDCODED_GREETING_JSON,
  isValidTransition,
  newSession,
  pushHistory,
  type Session,
} from "../bot/flow";
import {
  HARD_OBJECTION_THRESHOLD,
  buildObjectionResponse,
  detectObjection,
} from "../bot/objections";
import { detectSpecialCase } from "../bot/specialCases";

export const testRouter = Router();

let session: Session = newSession("test_dashboard");

testRouter.post("/message", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) { res.status(400).json({ error: "missing text" }); return; }

  await new Promise((r) => setTimeout(r, 10_000));

  const isFirst = session.history.length === 0 && session.state === "GREETING";
  if (isFirst) {
    pushHistory(session, "user", text);
    pushHistory(session, "assistant", HARDCODED_GREETING_JSON);
    session.state = "INTEREST";
    res.json({ messages: [HARDCODED_GREETING], state: session.state, cartUpdate: null });
    return;
  }

  const special = detectSpecialCase({ text, hasImage: false, state: session.state });
  if (special) {
    const out = special.response;
    pushHistory(session, "user", text);
    pushHistory(session, "assistant", JSON.stringify({ message: out, state: session.state, cartUpdate: null }));
    if (special.disableBot) session.automationEnabled = false;
    res.json({ messages: [out], state: session.state, special: special.type, cartUpdate: null });
    return;
  }

  pushHistory(session, "user", text);

  const objection = detectObjection(text);
  let claudeText: string;
  let nextState = session.state;
  let cartUpdate = null;

  if (objection && session.state !== "GREETING") {
    session.objectionCount += 1;
    claudeText = buildObjectionResponse(objection);
    nextState = "OBJECTION_HANDLING";
  } else {
    const reply = await askClaude(session, text);
    claudeText = reply.message;
    nextState = isValidTransition(session.state, reply.state) ? reply.state : session.state;
    cartUpdate = reply.cartUpdate;
  }

  const sanitized = sanitizeOutput(claudeText);
  if (cartUpdate) session.cart = cartUpdate as any;
  session.state = nextState;

  pushHistory(session, "assistant", JSON.stringify({ message: sanitized, state: nextState, cartUpdate }));

  res.json({ messages: [sanitized], state: session.state, cartUpdate });
});

testRouter.delete("/reset", (_req, res) => {
  session = newSession("test_dashboard");
  res.json({ ok: true });
});

testRouter.get("/state", (_req, res) => {
  res.json({
    state: session.state,
    cart: session.cart,
    objectionCount: session.objectionCount,
    turns: Math.floor(session.history.length / 2),
  });
});
