import { test } from "node:test";
import assert from "node:assert/strict";
import { containsBlocked, sanitizeOutput } from "../src/bot/blocklist";

test("blocklist: detects forbidden phrases", () => {
  const found = containsBlocked("Estimada cliente, compre ya este producto milagroso");
  assert.ok(found.includes("estimada cliente"));
  assert.ok(found.includes("compre ya"));
  assert.ok(found.includes("producto milagroso"));
});

test("sanitize: collapses repeated exclamation marks", () => {
  const out = sanitizeOutput("Hola amor!!!");
  assert.equal(out, "Hola amor!");
});

test("sanitize: limits emojis to 2 per message", () => {
  const out = sanitizeOutput("Hola ✨💛🌴☀️ amor 💛");
  const emojiCount = (out.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  assert.equal(emojiCount, 2);
});

test("sanitize: removes blocked phrases", () => {
  const out = sanitizeOutput("Compre ya este autobronceador");
  assert.ok(!/compre ya/i.test(out));
});

test("sanitize: lowercases shouty all-caps long words", () => {
  const out = sanitizeOutput("Es URGENTE amor");
  assert.ok(/Urgente/.test(out) || !/URGENTE/.test(out));
});

test("sanitize: trims excess whitespace", () => {
  const out = sanitizeOutput("Hola   amor\n\n\n\nlinda");
  assert.ok(!/   /.test(out));
  assert.ok(!/\n\n\n/.test(out));
});

test("sanitize: keeps normal text intact", () => {
  const out = sanitizeOutput("Hola amor ✨ ¿cómo estás?");
  assert.equal(out, "Hola amor ✨ ¿cómo estás?");
});
