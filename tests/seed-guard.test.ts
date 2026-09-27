import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("demo seed", () => {
  it("refuses to run when NODE_ENV=production", () => {
    expect(() =>
      execSync("npx tsx prisma/seed.ts", {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
          DIRECT_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
        },
      }),
    ).toThrow(/Refusing to seed/);
  });
});
