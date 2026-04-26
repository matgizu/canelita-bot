import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTransition } from "../src/bot/flow";

test("flow: GREETING → INTEREST is valid", () => {
  assert.equal(isValidTransition("GREETING", "INTEREST"), true);
});

test("flow: INTEREST → CLOSED is invalid", () => {
  assert.equal(isValidTransition("INTEREST", "CLOSED"), false);
});

test("flow: PAYMENT_METHOD → CLOSED is valid", () => {
  assert.equal(isValidTransition("PAYMENT_METHOD", "CLOSED"), true);
});

test("flow: same-state self-transition is valid", () => {
  assert.equal(isValidTransition("QUANTITY", "QUANTITY"), true);
});

test("flow: OBJECTION_HANDLING can go back to QUANTITY", () => {
  assert.equal(isValidTransition("OBJECTION_HANDLING", "QUANTITY"), true);
});

test("flow: ADDRESS_COLLECTION → PAYMENT_METHOD is valid", () => {
  assert.equal(isValidTransition("ADDRESS_COLLECTION", "PAYMENT_METHOD"), true);
});

test("flow: GREETING → CONFIRM_ORDER is invalid (skips required steps)", () => {
  assert.equal(isValidTransition("GREETING", "CONFIRM_ORDER"), false);
});
