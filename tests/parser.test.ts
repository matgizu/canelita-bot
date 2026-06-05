import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeReply } from "../src/bot/parser";

test("parser: direct JSON with all fields", () => {
  const r = parseClaudeReply(
    '{"message":"Hola amor ✨","state":"INTEREST","cartUpdate":[{"variant":"natural","quantity":2}]}',
    "GREETING",
  );
  assert.equal(r.message, "Hola amor ✨");
  assert.equal(r.state, "INTEREST");
  assert.deepEqual(r.cartUpdate, [{ variant: "natural", quantity: 2 }]);
});

test("parser: invalid state falls back", () => {
  const r = parseClaudeReply(
    '{"message":"hola","state":"INVENTADO","cartUpdate":null}',
    "QUANTITY",
  );
  assert.equal(r.state, "QUANTITY");
});

test("parser: JSON wrapped in markdown fence still parses (block extraction)", () => {
  const r = parseClaudeReply(
    '```json\n{"message":"hola","state":"GREETING","cartUpdate":null}\n```',
    "GREETING",
  );
  assert.equal(r.message, "hola");
  assert.equal(r.state, "GREETING");
});

test("parser: malformed JSON, regex fallback recovers message", () => {
  const r = parseClaudeReply(
    'Aquí va: {"message":"Hola amor","state":"GREETING", broken',
    "INTEREST",
  );
  assert.equal(r.message, "Hola amor");
});

test("parser: cart with invalid items is filtered", () => {
  const r = parseClaudeReply(
    '{"message":"x","state":"QUANTITY","cartUpdate":[{"variant":"foo","quantity":1},{"variant":"natural","quantity":3},{"variant":"intenso","quantity":0}]}',
    "QUANTITY",
  );
  assert.deepEqual(r.cartUpdate, [{ variant: "natural", quantity: 3 }]);
});

test("parser: plain text fallback returns text + fallback state", () => {
  const r = parseClaudeReply("Sin formato JSON", "INTEREST");
  assert.equal(r.state, "INTEREST");
  assert.match(r.message, /Sin formato JSON/);
});

test("parser: escaped newlines are decoded", () => {
  const r = parseClaudeReply(
    '{"message":"Línea 1\\nLínea 2","state":"GREETING","cartUpdate":null}',
    "GREETING",
  );
  assert.match(r.message, /Línea 1\nLínea 2/);
});
