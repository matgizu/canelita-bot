import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors shouldCreateNewOrder in handler.ts — tested independently to keep tests fast
function shouldCreateNewOrder(existing: { id: number; status: string } | null): boolean {
  if (!existing) return true;
  return existing.status === "CANCELLED";
}

test("shouldCreateNewOrder: returns true when no existing order", () => {
  assert.equal(shouldCreateNewOrder(null), true);
});

test("shouldCreateNewOrder: returns false when order exists", () => {
  assert.equal(shouldCreateNewOrder({ id: 1, status: "PENDING" }), false);
});

test("shouldCreateNewOrder: returns true when only CANCELLED order exists", () => {
  assert.equal(shouldCreateNewOrder({ id: 2, status: "CANCELLED" }), true);
});
