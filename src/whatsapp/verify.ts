import crypto from "node:crypto";
import { config } from "../config";

export function verifySignature(rawBody: Buffer, headerValue?: string): boolean {
  if (!headerValue) return false;
  const expected = headerValue.startsWith("sha256=")
    ? headerValue.slice(7)
    : headerValue;
  const computed = crypto
    .createHmac("sha256", config.whatsapp.appSecret)
    .update(rawBody)
    .digest("hex");
  if (expected.length !== computed.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(computed, "hex"),
  );
}

export function verifyChallenge(
  mode?: string,
  token?: string,
  challenge?: string,
): string | null {
  if (mode === "subscribe" && token === config.whatsapp.verifyToken && challenge) {
    return challenge;
  }
  return null;
}
