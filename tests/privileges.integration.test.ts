import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as sweepGet } from "@/app/api/cron/sweep/route";
import { prisma } from "@/lib/db";
import { disabledGuardTriggerProblem, runtimeRoleProblem } from "@/lib/db-role";
import { ensureSystemAccounts } from "@/lib/ledger/service";
import { ownerPrisma } from "./owner-db";

describe("runtime database role", () => {
  beforeAll(async () => {
    await ensureSystemAccounts();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it("connects the app as a non-superuser and the migrations as the owner", async () => {
    const [app] = await prisma.$queryRaw<{ current_user: string; rolsuper: boolean }[]>`
      SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    const [owner] = await ownerPrisma.$queryRaw<{ current_user: string; rolsuper: boolean }[]>`
      SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    expect(app.current_user).toBe("bridgingeden_app");
    expect(app.rolsuper).toBe(false);
    expect(owner.current_user).toBe("bridgingeden_owner");
    expect(owner.rolsuper).toBe(false);
    const [flags] = await ownerPrisma.$queryRaw<{ rolcreatedb: boolean; rolcreaterole: boolean }[]>`
      SELECT rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user
    `;
    expect(flags.rolcreatedb).toBe(false);
    expect(flags.rolcreaterole).toBe(false);
    expect(await runtimeRoleProblem(prisma)).toBeNull();
    expect(await runtimeRoleProblem(ownerPrisma)).toMatch(/bridgingeden_owner|ledger tables/);
    expect(await disabledGuardTriggerProblem(prisma)).toBeNull();
    const pgcrypto = await ownerPrisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `;
    expect(pgcrypto).toHaveLength(0);
  });

  it("reports an append-only trigger that is not enabled", async () => {
    await ownerPrisma.$executeRawUnsafe(`ALTER TABLE ledger_events DISABLE TRIGGER ledger_events_append_only`);
    try {
      expect(await disabledGuardTriggerProblem(prisma)).toMatch(/ledger_events_append_only/);
      process.env.CRON_SECRET = "cron-test-secret-for-trigger-check";
      const blocked = await sweepGet(
        new Request("http://localhost/api/cron/sweep", {
          headers: { authorization: "Bearer cron-test-secret-for-trigger-check" },
        }),
      );
      expect(blocked.status).toBe(500);
    } finally {
      await ownerPrisma.$executeRawUnsafe(`ALTER TABLE ledger_events ENABLE TRIGGER ledger_events_append_only`);
    }
    expect(await disabledGuardTriggerProblem(prisma)).toBeNull();
  });

  it("cannot truncate, disable triggers, change account kind, or replicate as the app", async () => {
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE ledger_events")).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRawUnsafe("ALTER TABLE ledger_events DISABLE TRIGGER ALL")).rejects.toThrow(
      /permission denied|must be owner/,
    );
    await expect(
      prisma.$executeRawUnsafe("UPDATE accounts SET kind = 'CONTRA' WHERE code = 'INVENTORY'"),
    ).rejects.toThrow(/permission denied|immutable/);
    await expect(prisma.$executeRawUnsafe("SET session_replication_role = replica")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO users (id, email, name, password_hash, role) VALUES ('evil-admin', 'evil-admin@test.local', 'Evil', 'x', 'ADMIN')",
      ),
    ).rejects.toThrow(/only the owner role/);
  });

  it("still blocks the owner from truncating until the truncate trigger is disabled", async () => {
    await expect(
      ownerPrisma.$executeRawUnsafe(
        "TRUNCATE TABLE retirement_verifications, ledger_events, ledger_postings, issued_serial_ranges, audit_logs",
      ),
    ).rejects.toThrow(/append-only/);
    const [account] = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind::text AS kind FROM accounts WHERE code = 'INVENTORY'
    `;
    expect(account.kind).toBe("ASSET");
  });
});
