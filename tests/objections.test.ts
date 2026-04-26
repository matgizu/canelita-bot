import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectionResponse, detectObjection } from "../src/bot/objections";

test("objections: detects price complaint", () => {
  const obj = detectObjection("uy esta muy caro");
  assert.ok(obj);
  assert.equal(obj!.type, "price");
});

test("objections: detects doubt about results", () => {
  const obj = detectObjection("y si no me gusta?");
  assert.ok(obj);
  assert.equal(obj!.type, "doubt_results");
});

test("objections: detects safety/allergy concern", () => {
  const obj = detectObjection("soy alérgica a los parabenos");
  assert.ok(obj);
  assert.equal(obj!.type, "safety");
});

test("objections: detects 'tengo que pensarlo'", () => {
  const obj = detectObjection("dejame pensarlo");
  assert.ok(obj);
  assert.equal(obj!.type, "needs_to_think");
});

test("objections: returns null for normal messages", () => {
  const obj = detectObjection("quiero el bronceador color natural");
  assert.equal(obj, null);
});

test("buildObjectionResponse: validate + rebut + followUp joined", () => {
  const obj = detectObjection("esta caro")!;
  const out = buildObjectionResponse(obj);
  assert.match(out, /entiendo|reina/i);
  assert.match(out, /\$|solarium/i);
});
