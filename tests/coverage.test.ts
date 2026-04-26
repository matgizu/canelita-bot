import { test } from "node:test";
import assert from "node:assert/strict";
import { findCoverage, isInternational } from "../src/coverage";

test("coverage: Bogotá is standard 2-4 days", () => {
  const r = findCoverage("Bogotá");
  assert.ok(r);
  assert.equal(r!.zone.tier, "standard");
});

test("coverage: matches without accents", () => {
  const r = findCoverage("medellin");
  assert.ok(r);
  assert.equal(r!.zone.tier, "standard");
});

test("coverage: San Andrés is extended (requires prepaid)", () => {
  const r = findCoverage("San Andrés");
  assert.ok(r);
  assert.equal(r!.zone.tier, "extended");
  assert.equal(r!.zone.requiresPrepaid, true);
});

test("coverage: Leticia is remote", () => {
  const r = findCoverage("Leticia");
  assert.ok(r);
  assert.equal(r!.zone.tier, "remote");
});

test("coverage: unknown city returns null", () => {
  const r = findCoverage("Pueblo Inventado XYZ");
  assert.equal(r, null);
});

test("isInternational: detects Mexico", () => {
  assert.equal(isInternational("envían a México?"), true);
});

test("isInternational: false for Colombian city", () => {
  assert.equal(isInternational("vivo en Bogotá"), false);
});
