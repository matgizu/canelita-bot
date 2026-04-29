import { test } from "node:test";
import assert from "node:assert/strict";
import { msUntilNextDayColTime } from "../src/bot/flow";

test("msUntilNextDayColTime: next 8am COL is always in future", () => {
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  assert.ok(delay > 0, "delay must be positive");
});

test("msUntilNextDayColTime: next 8am COL is within 1 to 49 hours", () => {
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  const hours = delay / (60 * 60 * 1000);
  assert.ok(hours >= 1,  `delay too short: ${hours.toFixed(1)}h`);
  assert.ok(hours <= 49, `delay too long: ${hours.toFixed(1)}h`);
});

test("msUntilNextDayColTime: 3pm COL is at least 7h after 8am COL same day", () => {
  const now = Date.now();
  const t3 = msUntilNextDayColTime(now, 8);
  const t4 = msUntilNextDayColTime(now, 15);
  assert.ok(t4 > t3, "3pm must be after 8am");
  const diffH = (t4 - t3) / (60 * 60 * 1000);
  assert.ok(Math.abs(diffH - 7) < 0.1, `expected 7h gap, got ${diffH.toFixed(2)}h`);
});
