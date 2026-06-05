import { test } from "node:test";
import assert from "node:assert/strict";
import { msUntilNextDayColTime } from "../src/bot/flow";

test("msUntilNextDayColTime: next 8am COL is always in future", () => {
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  assert.ok(delay > 0, "delay must be positive");
});

test("msUntilNextDayColTime: next 8am COL is between 8 and 24 hours", () => {
  // Min ~8h: session created at COL 11:59pm → next-day 8am is ~8h away
  // Max <24h: session created just after COL 8am → next-day 8am is ~24h away
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  const hours = delay / (60 * 60 * 1000);
  assert.ok(hours > 7,  `delay too short: ${hours.toFixed(1)}h`);
  assert.ok(hours < 25, `delay too long: ${hours.toFixed(1)}h`);
});

test("msUntilNextDayColTime: 3pm COL fires exactly 7h after 8am COL", () => {
  const now = Date.now();
  const t3 = msUntilNextDayColTime(now, 8);
  const t4 = msUntilNextDayColTime(now, 15);
  assert.ok(t4 > t3, "3pm must be after 8am");
  const diffH = (t4 - t3) / (60 * 60 * 1000);
  assert.ok(Math.abs(diffH - 7) < 0.01, `expected 7h gap, got ${diffH.toFixed(3)}h`);
});

test("msUntilNextDayColTime: COL 10pm session fires next-day 8am (not day+2)", () => {
  // COL Apr 29 10pm = UTC Apr 30 03:00
  const col10pm = new Date("2026-04-30T03:00:00Z").getTime();
  const delay = msUntilNextDayColTime(col10pm, 8);
  const hours = delay / (60 * 60 * 1000);
  // Should fire COL Apr 30 8am = UTC Apr 30 13:00 → 10h away
  assert.ok(hours < 24, `should fire within 24h (next COL day), got ${hours.toFixed(1)}h`);
  const fireAt = new Date(col10pm + delay);
  assert.equal(fireAt.toISOString(), "2026-04-30T13:00:00.000Z");
});
