import { createHash, timingSafeEqual } from "node:crypto";

export function cronBearerMatches(secret: string, header: string | null): boolean {
  if (!secret) return false;
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expected, actual);
}
