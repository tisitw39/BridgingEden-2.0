import { createHmac } from "node:crypto";

export function auditEmailHmac(email: string, key = process.env.AUDIT_EMAIL_HMAC_KEY): string {
  if (!key || new TextEncoder().encode(key).length < 32) {
    throw new Error("AUDIT_EMAIL_HMAC_KEY must be at least 32 bytes.");
  }
  return createHmac("sha256", key).update(email).digest("hex");
}
