import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error(`REDIRECT ${url}`);
    (error as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  },
}));

vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
  }),
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({}),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));

import { auth } from "@/auth";
import { GET as certificateGet } from "@/app/api/certificates/[eventId]/route";
import { GET as sweepGet } from "@/app/api/cron/sweep/route";
import { prisma } from "@/lib/db";
import { transferAction } from "@/lib/actions/holdings";
import { retireAction } from "@/lib/actions/retire";
import { EMAIL_WIDE_AFTER, authenticate, normaliseLoginEmail } from "@/lib/authenticate";
import { auditEmailHmac } from "@/lib/audit-email";
import { allowVerificationLookup } from "@/lib/verify";
import { currentUser } from "@/lib/session";
import {
  approveBatch,
  draftBatch,
  ensureHolderAccount,
  ensureSystemAccounts,
  transferCredits,
} from "@/lib/ledger/service";
import { signOutAction } from "@/lib/actions/auth";
import { BCRYPT_COST, changePassword } from "@/lib/passwords";
import { requireAdmin } from "@/lib/session";
import { ownerPrisma } from "./owner-db";
import { resetTransactionalData } from "./reset-db";

const authMock = vi.mocked(auth);

let adminId = "";
let approverId = "";
let holderId = "";
let otherHolderId = "";
let holderAccountId = "";
let otherAccountId = "";

async function signInAs(id: string, role: "ADMIN" | "HOLDER") {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { tokenVersion: true } });
  authMock.mockResolvedValue({
    user: { id, role, email: `${id}@test.local`, tokenVersion: user.tokenVersion },
  } as never);
}

describe("authentication and authorisation", () => {
  beforeAll(async () => {
    await ensureSystemAccounts();
    const passwordHash = await hash("HolderDemo!2026", BCRYPT_COST);
    const admin = await ownerPrisma.user.upsert({
      where: { email: "auth-admin@test.local" },
      update: { role: "ADMIN", passwordHash },
      create: { email: "auth-admin@test.local", name: "Auth Admin", passwordHash, role: "ADMIN" },
    });
    const approver = await ownerPrisma.user.upsert({
      where: { email: "auth-approver@test.local" },
      update: { role: "ADMIN", passwordHash },
      create: { email: "auth-approver@test.local", name: "Auth Approver", passwordHash, role: "ADMIN" },
    });
    const holder = await ownerPrisma.user.upsert({
      where: { email: "auth-holder@test.local" },
      update: { role: "HOLDER", passwordHash },
      create: { email: "auth-holder@test.local", name: "Auth Holder", passwordHash, role: "HOLDER" },
    });
    const other = await ownerPrisma.user.upsert({
      where: { email: "auth-other@test.local" },
      update: { role: "HOLDER", passwordHash },
      create: { email: "auth-other@test.local", name: "Auth Other", passwordHash, role: "HOLDER" },
    });
    holderAccountId = (await ensureHolderAccount(prisma, holder)).id;
    otherAccountId = (await ensureHolderAccount(prisma, other)).id;
    adminId = admin.id;
    approverId = approver.id;
    holderId = holder.id;
    otherHolderId = other.id;
  });

  beforeEach(async () => {
    await resetTransactionalData();
    await ownerPrisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it("sends a holder away from admin actions", async () => {
    await signInAs(holderId, "HOLDER");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /portfolio");
    const form = new FormData();
    form.set("fromAccountId", otherAccountId);
    form.set("toAccountId", holderAccountId);
    form.set("projectId", "missing");
    form.set("vintageYear", "2024");
    form.set("quantity", "1");
    await expect(transferAction(form)).rejects.toThrow("REDIRECT /portfolio");
    expect(await prisma.ledgerEvent.count()).toBe(0);
  });

  it("applies a demotion even when the token still says admin", async () => {
    await ownerPrisma.user.update({ where: { id: adminId }, data: { role: "HOLDER" } });
    await signInAs(adminId, "ADMIN");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /portfolio");
  });

  it("retires only the signed-in holder's credits and hides another holder's certificate", async () => {
    const project = await prisma.project.create({
      data: {
        code: "AUTHZ",
        name: "Auth woodland",
        location: "Co. Wicklow, Ireland",
        methodology: "Native Woodland Establishment",
        standardReference: "BE-REG-AUTHZ",
        description: "Authorisation fixture for holder isolation.",
        createdById: adminId,
      },
    });
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 8,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await approveBatch(batch.id, approverId);
    const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
    await transferCredits({
      fromAccountId: inventory.id,
      toAccountId: otherAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 8,
      actorId: adminId,
    });

    await signInAs(holderId, "HOLDER");
    const steal = new FormData();
    steal.set("holding", `${project.id}:2024`);
    steal.set("quantity", "8");
    steal.set("beneficiary", "Northwind Office Ltd");
    steal.set("reason", "Trying another holder's tonnes");
    await expect(retireAction(steal)).rejects.toThrow("REDIRECT /portfolio");
    expect(await prisma.ledgerEvent.count({ where: { type: "RETIREMENT" } })).toBe(0);

    await transferCredits({
      fromAccountId: otherAccountId,
      toAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 3,
      actorId: adminId,
    });
    const own = new FormData();
    own.set("holding", `${project.id}:2024`);
    own.set("quantity", "2");
    own.set("beneficiary", "Northwind Office Ltd");
    own.set("reason", "Holder's own retirement");
    await expect(retireAction(own)).rejects.toThrow("REDIRECT /portfolio?notice=retired");
    const retirement = await prisma.ledgerEvent.findFirstOrThrow({
      where: { type: "RETIREMENT" },
      include: { postings: { include: { account: true } } },
    });
    expect(
      retirement.postings.some((posting) => posting.side === "CREDIT" && posting.accountId === holderAccountId),
    ).toBe(true);

    await signInAs(otherHolderId, "HOLDER");
    const denied = await certificateGet(new Request("http://localhost/api/certificates/" + retirement.id), {
      params: Promise.resolve({ eventId: retirement.id }),
    });
    expect(denied.status).toBe(404);

    await signInAs(holderId, "HOLDER");
    const allowed = await certificateGet(new Request("http://localhost/api/certificates/" + retirement.id), {
      params: Promise.resolve({ eventId: retirement.id }),
    });
    expect(allowed.status).toBe(200);
  });

  it("audits failed logins on the shared authenticate path and rate limits them", async () => {
    const marker = "not-a-real-mailbox";
    const oversized = `${marker}${"x".repeat(300)}@example.com`;
    const missing = await authenticate(oversized, "wrong-password", "203.0.113.5");
    expect(missing).toBeNull();
    await authenticate("other-unknown@example.com", "wrong-password", "203.0.113.5");
    const missingAudits = await prisma.auditLog.findMany({
      where: { action: "auth.login_failed_unknown", entityId: "203.0.113.5" },
    });
    expect(missingAudits).toHaveLength(1);
    expect(JSON.stringify(missingAudits)).not.toContain(marker);
    expect(JSON.stringify(missingAudits)).not.toContain("emailSha256");
    const detail = missingAudits[0]?.detail as { emailHmac?: string };
    expect(detail.emailHmac).toBe(auditEmailHmac(normaliseLoginEmail(oversized)));
    const storedEmails = await prisma.loginAttempt.findMany({ where: { ip: "203.0.113.5" } });
    expect(storedEmails.every((row) => row.email === "unknown")).toBe(true);

    const wrong = await authenticate("auth-holder@test.local", "not-the-password", "203.0.113.5");
    expect(wrong).toBeNull();
    const wrongAudit = await prisma.auditLog.findFirst({
      where: { action: "auth.login_failed", actorId: holderId },
    });
    expect(wrongAudit).toBeTruthy();

    await prisma.loginAttempt.deleteMany({ where: { email: "auth-holder@test.local" } });
    const ok = await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.5");
    expect(ok?.id).toBe(holderId);
    expect(await prisma.auditLog.count({ where: { action: "auth.login", actorId: holderId } })).toBe(1);

    await prisma.loginAttempt.deleteMany();
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 8 }, () => ({ email: "auth-holder@test.local", ip: "203.0.113.9" })),
    });
    const limited = await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.9");
    expect(limited).toBeNull();
    expect(await prisma.loginAttempt.count({ where: { email: "auth-holder@test.local" } })).toBe(8);
  });

  it("does not let a concurrent login burst exceed one guess in the backoff window", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        authenticate("auth-holder@test.local", "not-the-password", "198.51.100.24"),
      ),
    );
    expect(results.every((result) => result === null)).toBe(true);
    expect(await prisma.loginAttempt.count({ where: { email: "auth-holder@test.local" } })).toBe(1);
  }, 60_000);

  it("writes one audit row for a rate-limited window", async () => {
    await prisma.loginAttempt.create({
      data: { email: "auth-holder@test.local", ip: "203.0.113.9" },
    });
    expect(await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.9")).toBeNull();
    expect(await authenticate("auth-holder@test.local", "wrong-password", "203.0.113.9")).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: "auth.login_rate_limited", entityId: holderId } }),
    ).toBe(1);
  });

  it("does not let one IP's failures lock the same account on another IP", async () => {
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 10 }, () => ({ email: "auth-holder@test.local", ip: "203.0.113.9" })),
    });
    const fromOtherIp = await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.50");
    expect(fromOtherIp?.id).toBe(holderId);
    await prisma.loginAttempt.deleteMany({ where: { email: "auth-holder@test.local" } });
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: EMAIL_WIDE_AFTER }, (_, index) => ({
        email: "auth-holder@test.local",
        ip: `198.51.100.${index}`,
      })),
    });
    expect(await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.77")).toBeNull();
  });

  it("still compares a password when the account is already in backoff", async () => {
    await prisma.loginAttempt.create({
      data: { email: "auth-holder@test.local", ip: "203.0.113.9" },
    });
    const limitedStarted = Date.now();
    expect(await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.9")).toBeNull();
    const limitedMs = Date.now() - limitedStarted;
    const unknownStarted = Date.now();
    expect(await authenticate("nobody-timing@example.com", "HolderDemo!2026", "203.0.113.61")).toBeNull();
    const unknownMs = Date.now() - unknownStarted;
    expect(limitedMs).toBeGreaterThan(40);
    expect(unknownMs).toBeGreaterThan(40);
  });

  it("bumps the token version on logout", async () => {
    await signInAs(holderId, "HOLDER");
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: holderId },
      select: { tokenVersion: true },
    });
    await signOutAction();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: holderId },
      select: { tokenVersion: true },
    });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  });

  it("rejects a common password and then accepts a replacement", async () => {
    await expect(changePassword(holderId, "HolderDemo!2026", "password123")).rejects.toThrow(/too common/);
  });

  it("changes a password with one hash and then accepts only the new one", async () => {
    await changePassword(holderId, "HolderDemo!2026", "Replacement!2026");
    await prisma.loginAttempt.deleteMany({ where: { email: "auth-holder@test.local" } });
    expect(await authenticate("auth-holder@test.local", "HolderDemo!2026", "203.0.113.5")).toBeNull();
    await prisma.loginAttempt.deleteMany({ where: { email: "auth-holder@test.local" } });
    expect((await authenticate("auth-holder@test.local", "Replacement!2026", "203.0.113.5"))?.id).toBe(holderId);
    await changePassword(holderId, "Replacement!2026", "HolderDemo!2026");
  });

  it("invalidates sessions issued before a password change", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: holderId },
      select: { tokenVersion: true },
    });
    await signInAs(holderId, "HOLDER");
    expect((await currentUser())?.id).toBe(holderId);
    await changePassword(holderId, "HolderDemo!2026", "Replacement!2026");
    authMock.mockResolvedValue({
      user: { id: holderId, role: "HOLDER", email: "auth-holder@test.local", tokenVersion: before.tokenVersion },
    } as never);
    expect(await currentUser()).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: holderId },
      select: { tokenVersion: true },
    });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    await signInAs(holderId, "HOLDER");
    expect((await currentUser())?.id).toBe(holderId);
    await changePassword(holderId, "Replacement!2026", "HolderDemo!2026");
  });

  it("stops verification lookups after the limit and treats a busy lock as busy", async () => {
    const ip = "198.51.100.41";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(await allowVerificationLookup(ip)).toBe("ok");
    }
    expect(await allowVerificationLookup(ip)).toBe("limited");
    const burstIp = "198.51.100.40";
    const results = await Promise.all(Array.from({ length: 40 }, () => allowVerificationLookup(burstIp)));
    const allowed = results.filter((result) => result === "ok").length;
    expect(allowed).toBeGreaterThanOrEqual(1);
    expect(allowed).toBeLessThanOrEqual(30);
    expect(await prisma.verifyLookup.count({ where: { ip: burstIp } })).toBe(allowed);
  });

  it("requires the cron secret before sweeping old login rows", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    await prisma.loginAttempt.create({
      data: {
        email: "old-sweep@example.com",
        ip: "198.51.100.8",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    });
    const denied = await sweepGet(new Request("http://localhost/api/cron/sweep"));
    expect(denied.status).toBe(401);
    expect(await prisma.loginAttempt.count({ where: { email: "old-sweep@example.com" } })).toBe(1);
    const allowed = await sweepGet(
      new Request("http://localhost/api/cron/sweep", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(await prisma.loginAttempt.count({ where: { email: "old-sweep@example.com" } })).toBe(0);
  });
});
