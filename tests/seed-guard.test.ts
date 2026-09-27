import { execSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { ownerPrisma } from "./owner-db";

describe("demo seed", () => {
  afterAll(async () => {
    await ownerPrisma.user.deleteMany({ where: { email: "stranger-seed-guard@example.com" } });
    await ownerPrisma.$disconnect();
  });

  it("refuses to run when NODE_ENV=production even if the demo flag is set", () => {
    expect(() =>
      execSync("npx tsx prisma/seed.ts", {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          ALLOW_DEMO_SEED: "1",
          DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
          DIRECT_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
        },
      }),
    ).toThrow(/NODE_ENV=production/);
  });

  it("refuses to run without ALLOW_DEMO_SEED=1", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
      DIRECT_URL: "postgresql://invalid:invalid@127.0.0.1:1/none",
    };
    delete env.ALLOW_DEMO_SEED;
    expect(() => execSync("npx tsx prisma/seed.ts", { encoding: "utf8", env })).toThrow(/ALLOW_DEMO_SEED/);
  });

  it("refuses to run when a non-demo user exists", async () => {
    await ownerPrisma.user.upsert({
      where: { email: "stranger-seed-guard@example.com" },
      update: {},
      create: {
        email: "stranger-seed-guard@example.com",
        name: "Stranger",
        passwordHash: "x",
        role: "HOLDER",
      },
    });
    expect(() =>
      execSync("npx tsx prisma/seed.ts", {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "development", ALLOW_DEMO_SEED: "1" },
      }),
    ).toThrow(/non-demo users/);
  });
});
