import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeReply } from "../src/bot/parser";

test("parseClaudeReply: extracts reminder when present", () => {
  const raw = JSON.stringify({
    message: "Claro reina, te escribo el jueves 💛",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
    reminder: { note: "Cliente dijo que escribe el jueves", daysFromNow: 3 },
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.ok(result.reminder !== null, "reminder should be set");
  assert.equal(result.reminder!.daysFromNow, 3);
  assert.equal(result.reminder!.note, "Cliente dijo que escribe el jueves");
});

test("parseClaudeReply: reminder is null when absent", () => {
  const raw = JSON.stringify({
    message: "Hola reina ✨",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.equal(result.reminder, null);
});

test("parseClaudeReply: reminder with daysFromNow=0 is rejected", () => {
  const raw = JSON.stringify({
    message: "Hola",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
    reminder: { note: "test", daysFromNow: 0 },
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.equal(result.reminder, null);
});
