import path from "node:path";
import { defineConfig } from "vitest/config";
import { requiredEnv } from "./tests/required-env";

const testDatabaseUrl = requiredEnv("TEST_DATABASE_URL");
const testOwnerUrl = requiredEnv("TEST_DIRECT_URL");

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 60_000,
    testTimeout: 30_000,
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testOwnerUrl,
      AUDIT_EMAIL_HMAC_KEY: process.env.AUDIT_EMAIL_HMAC_KEY ?? "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
