import { execSync } from "node:child_process";
import { requiredEnv } from "./required-env";

export default function setup() {
  const databaseUrl = requiredEnv("TEST_DATABASE_URL");
  const directUrl = requiredEnv("TEST_DIRECT_URL");
  const hmac = process.env.AUDIT_EMAIL_HMAC_KEY ?? "";
  if (new TextEncoder().encode(hmac).length < 32) {
    throw new Error("AUDIT_EMAIL_HMAC_KEY must be at least 32 bytes to run the test suite.");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
  });
}
