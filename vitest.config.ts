import path from "node:path";
import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  "postgresql://bridgingeden_app:bridgingeden_app@127.0.0.1:5432/bridgingeden_test?schema=public";
const testOwnerUrl =
  "postgresql://bridgingeden_owner:bridgingeden_owner@127.0.0.1:5432/bridgingeden_test?schema=public";

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
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
