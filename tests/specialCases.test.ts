import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpecialCase } from "../src/bot/specialCases";

test("specialCases: wholesaler triggers disable bot + telegram", () => {
  const r = detectSpecialCase({ text: "hola me interesa pero para revender" });
  assert.ok(r);
  assert.equal(r!.type, "wholesaler");
  assert.equal(r!.disableBot, true);
  assert.equal(r!.notifyTelegram, true);
});

test("specialCases: wholesaler quantity triggers", () => {
  const r = detectSpecialCase({ text: "necesito 50 unidades" });
  assert.ok(r);
  assert.equal(r!.type, "wholesaler");
});

test("specialCases: laser depilation", () => {
  const r = detectSpecialCase({ text: "estoy en depilación láser" });
  assert.ok(r);
  assert.equal(r!.type, "laser_depilation");
  assert.equal(r!.disableBot, false);
});

test("specialCases: face application", () => {
  const r = detectSpecialCase({ text: "se puede en la cara?" });
  assert.ok(r);
  assert.equal(r!.type, "face_application");
});

test("specialCases: pregnancy", () => {
  const r = detectSpecialCase({ text: "estoy embarazada" });
  assert.ok(r);
  assert.equal(r!.type, "pregnancy_lactation");
});

test("specialCases: international shipping", () => {
  const r = detectSpecialCase({ text: "envían a México?" });
  assert.ok(r);
  assert.equal(r!.type, "international_shipping");
});

test("specialCases: payment proof image at PAYMENT_METHOD", () => {
  const r = detectSpecialCase({
    text: "",
    hasImage: true,
    state: "PAYMENT_METHOD",
  });
  assert.ok(r);
  assert.equal(r!.type, "payment_proof");
  assert.equal(r!.closeOrder, true);
});

test("specialCases: 'es original?' question", () => {
  const r = detectSpecialCase({ text: "será original?" });
  assert.ok(r);
  assert.equal(r!.type, "is_original");
});

test("specialCases: normal message returns null", () => {
  const r = detectSpecialCase({ text: "quiero el natural" });
  assert.equal(r, null);
});
