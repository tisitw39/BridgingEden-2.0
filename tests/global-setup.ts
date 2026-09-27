import { execSync } from "node:child_process";

const testDatabaseUrl =
  "postgresql://bridgingeden_app:bridgingeden_app@127.0.0.1:5432/bridgingeden_test?schema=public";
const testOwnerUrl =
  "postgresql://bridgingeden_owner:bridgingeden_owner@127.0.0.1:5432/bridgingeden_test?schema=public";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl, DIRECT_URL: testOwnerUrl },
  });
}
