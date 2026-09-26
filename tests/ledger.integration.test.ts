import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { buildRetirementCertificate } from "@/lib/certificate";
import { listHoldings } from "@/lib/ledger/queries";
import {
  approveBatch,
  cancelCredits,
  draftBatch,
  ensureHolderAccount,
  ensureSystemAccounts,
  reconcile,
  rejectBatch,
  retireCredits,
  transferCredits,
} from "@/lib/ledger/service";
import { LedgerError } from "@/lib/ledger/errors";

let adminId = "";
let holderId = "";
let holderAccountId = "";
let otherHolderAccountId = "";

async function resetTransactionalData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs,
      issued_serial_ranges,
      ledger_postings,
      ledger_events,
      credit_batches,
      project_documents,
      projects
    RESTART IDENTITY CASCADE
  `);
}

async function makeProject(code = "TEST") {
  return prisma.project.create({
    data: {
      code,
      name: `${code} woodland`,
      location: "Co. Wicklow, Ireland",
      methodology: "Native Woodland Establishment",
      standardReference: `BE-REG-${code}`,
      description: "Integration fixture for the carbon ledger.",
      createdById: adminId,
    },
  });
}

async function issue(projectId: string, quantity: number, vintageYear = 2024) {
  const batch = await draftBatch({
    projectId,
    vintageYear,
    quantity,
    methodology: "Native Woodland Establishment",
    actorId: adminId,
  });
  return approveBatch(batch.id, adminId);
}

async function inventoryId() {
  const account = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
  return account.id;
}

describe("ledger database rules", () => {
  beforeAll(async () => {
    const [database] = await prisma.$queryRaw<{ current_database: string }[]>`
      SELECT current_database()
    `;
    expect(database.current_database).toBe("bridgingeden_test");

    await ensureSystemAccounts();
    const passwordHash = await hash("password123", 4);
    const admin = await prisma.user.upsert({
      where: { email: "ledger-admin@test.local" },
      update: {},
      create: {
        email: "ledger-admin@test.local",
        name: "Ledger Admin",
        passwordHash,
        role: "ADMIN",
      },
    });
    const holder = await prisma.user.upsert({
      where: { email: "ledger-holder@test.local" },
      update: {},
      create: {
        email: "ledger-holder@test.local",
        name: "Ledger Holder",
        passwordHash,
        role: "HOLDER",
      },
    });
    const other = await prisma.user.upsert({
      where: { email: "ledger-other@test.local" },
      update: {},
      create: {
        email: "ledger-other@test.local",
        name: "Other Holder",
        passwordHash,
        role: "HOLDER",
      },
    });
    const holderAccount = await ensureHolderAccount(prisma, holder);
    const otherAccount = await ensureHolderAccount(prisma, other);
    adminId = admin.id;
    holderId = holder.id;
    holderAccountId = holderAccount.id;
    otherHolderAccountId = otherAccount.id;
  });

  beforeEach(async () => {
    await resetTransactionalData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("assigns a unique serial range on approval and derives the inventory balance", async () => {
    const project = await makeProject();
    const first = await issue(project.id, 100);
    const second = await issue(project.id, 40, 2025);
    expect(first).toMatchObject({ serialStart: 1, serialEnd: 100, quantity: 100 });
    expect(second).toMatchObject({ serialStart: 101, serialEnd: 140, quantity: 40 });

    const holdings = await listHoldings(await inventoryId());
    expect(holdings.map((row) => ({ vintage: row.vintageYear, quantity: row.quantity, ranges: row.ranges }))).toEqual([
      { vintage: 2024, quantity: 100, ranges: [{ start: 1, end: 100 }] },
      { vintage: 2025, quantity: 40, ranges: [{ start: 101, end: 140 }] },
    ]);

    const balanceColumn = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name ILIKE '%balance%'
    `;
    expect(balanceColumn).toEqual([]);
    expect(await reconcile()).toMatchObject({ ok: true, issued: 140, held: 140, retired: 0, cancelled: 0 });
  });

  it("does not touch the ledger when a batch is drafted or rejected", async () => {
    const project = await makeProject();
    const draft = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 15,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    expect(await prisma.ledgerEvent.count()).toBe(0);
    await rejectBatch(draft.id, adminId, "Methodology note is incomplete.");
    expect(await prisma.ledgerEvent.count()).toBe(0);
    await expect(approveBatch(draft.id, adminId)).rejects.toBeInstanceOf(LedgerError);
  });

  it("splits a serial range on a partial transfer and keeps both balances", async () => {
    const project = await makeProject();
    await issue(project.id, 100);
    const moved = await transferCredits({
      fromAccountId: await inventoryId(),
      toAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 25,
      actorId: adminId,
    });
    expect(moved.ranges).toEqual([{ start: 1, end: 25 }]);

    const middle = await transferCredits({
      fromAccountId: await inventoryId(),
      toAccountId: otherHolderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      serialStart: 40,
      serialEnd: 60,
      actorId: adminId,
    });
    expect(middle.ranges).toEqual([{ start: 40, end: 60 }]);

    const inventory = await listHoldings(await inventoryId());
    const holder = await listHoldings(holderAccountId);
    const other = await listHoldings(otherHolderAccountId);
    expect(inventory[0]).toMatchObject({
      quantity: 54,
      ranges: [
        { start: 26, end: 39 },
        { start: 61, end: 100 },
      ],
    });
    expect(holder[0]).toMatchObject({ quantity: 25, ranges: [{ start: 1, end: 25 }] });
    expect(other[0]).toMatchObject({ quantity: 21, ranges: [{ start: 40, end: 60 }] });
    expect(await reconcile()).toMatchObject({ ok: true, issued: 100, held: 100 });
  });

  it("moves a serial back to a previous holder and then retires part of it", async () => {
    const project = await makeProject();
    await issue(project.id, 80);
    const fromInventory = {
      fromAccountId: await inventoryId(),
      projectId: project.id,
      vintageYear: 2024,
      actorId: adminId,
    };
    await transferCredits({ ...fromInventory, toAccountId: holderAccountId, quantity: 80 });
    await transferCredits({
      fromAccountId: holderAccountId,
      toAccountId: await inventoryId(),
      projectId: project.id,
      vintageYear: 2024,
      quantity: 80,
      actorId: adminId,
    });
    await transferCredits({ ...fromInventory, toAccountId: holderAccountId, quantity: 30 });

    const retired = await retireCredits({
      fromAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 10,
      beneficiary: "Northwind Office Ltd",
      reason: "Corporate greenhouse gas inventory",
      actorId: holderId,
    });
    expect(retired.ranges).toEqual([{ start: 1, end: 10 }]);
    expect((await listHoldings(holderAccountId))[0]).toMatchObject({
      quantity: 20,
      ranges: [{ start: 11, end: 30 }],
    });
    expect(await reconcile()).toMatchObject({ ok: true, issued: 80, held: 70, retired: 10, cancelled: 0 });

    const pdf = await buildRetirementCertificate(retired.eventId);
    expect(pdf).not.toBeNull();
    expect(Buffer.from(pdf!).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("refuses transfers and retirements that would make a balance negative", async () => {
    const project = await makeProject();
    await issue(project.id, 12);
    await transferCredits({
      fromAccountId: await inventoryId(),
      toAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 12,
      actorId: adminId,
    });

    await expect(
      retireCredits({
        fromAccountId: holderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        quantity: 13,
        beneficiary: "Northwind Office Ltd",
        reason: "Too many tonnes",
        actorId: holderId,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT" });

    await expect(
      transferCredits({
        fromAccountId: holderAccountId,
        toAccountId: otherHolderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        serialStart: 1,
        serialEnd: 20,
        actorId: adminId,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT" });

    expect((await listHoldings(holderAccountId))[0].quantity).toBe(12);
    expect(await reconcile()).toMatchObject({ ok: true, held: 12, retired: 0 });
  });

  it("cancels credits out of the holding balance", async () => {
    const project = await makeProject();
    await issue(project.id, 20);
    await cancelCredits({
      fromAccountId: await inventoryId(),
      projectId: project.id,
      vintageYear: 2024,
      quantity: 5,
      reason: "Issued against the wrong project boundary.",
      actorId: adminId,
    });
    expect((await listHoldings(await inventoryId()))[0]).toMatchObject({
      quantity: 15,
      ranges: [{ start: 6, end: 20 }],
    });
    expect(await reconcile()).toMatchObject({ ok: true, issued: 20, held: 15, cancelled: 5, retired: 0 });
  });

  it("lets each project start its own serial sequence", async () => {
    const glen = await makeProject("GLENX");
    const beara = await makeProject("BEARX");
    const glenIssue = await issue(glen.id, 8);
    const bearaIssue = await issue(beara.id, 8);
    expect(glenIssue.serialStart).toBe(1);
    expect(bearaIssue.serialStart).toBe(1);
    expect(await reconcile()).toMatchObject({ ok: true, issued: 16, held: 16 });
  });

  it("rejects a second issuance of an overlapping serial in the database", async () => {
    const project = await makeProject();
    await issue(project.id, 50);
    const inventory = await inventoryId();
    const issuance = await prisma.account.findUniqueOrThrow({ where: { code: "ISSUANCE" } });

    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: adminId,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: inventory,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 40,
            serialEnd: 60,
            quantity: 21,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: issuance.id,
            side: "CREDIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 40,
            serialEnd: 60,
            quantity: 21,
          },
        });
      }),
    ).rejects.toThrow(/issued_serials_do_not_overlap|exclusion constraint/);

    expect(await reconcile()).toMatchObject({ ok: true, issued: 50, held: 50 });
  });

  it("rejects a credit for serials the account does not hold", async () => {
    const project = await makeProject();
    await issue(project.id, 10);
    const inventory = await inventoryId();

    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "TRANSFER",
            projectId: project.id,
            vintageYear: 2024,
            actorId: adminId,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: inventory,
            side: "CREDIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 20,
            quantity: 20,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: holderAccountId,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 20,
            quantity: 20,
          },
        });
      }),
    ).rejects.toThrow(/uncovered credit/);
  });

  it("rejects unbalanced events and empty events", async () => {
    const project = await makeProject();
    const inventory = await inventoryId();
    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: adminId,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: inventory,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 5,
            quantity: 5,
          },
        });
      }),
    ).rejects.toThrow(/unbalanced ledger event/);

    await expect(
      prisma.ledgerEvent.create({
        data: {
          type: "CANCELLATION",
          projectId: project.id,
          vintageYear: 2024,
          actorId: adminId,
        },
      }),
    ).rejects.toThrow(/has no postings/);
  });

  it("is append-only", async () => {
    const project = await makeProject();
    await issue(project.id, 4);
    const posting = await prisma.ledgerPosting.findFirstOrThrow();
    const event = await prisma.ledgerEvent.findFirstOrThrow();
    const audit = await prisma.auditLog.findFirstOrThrow();
    await expect(
      prisma.ledgerPosting.update({ where: { id: posting.id }, data: { quantity: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerPosting.delete({ where: { id: posting.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.auditLog.update({ where: { id: audit.id }, data: { action: "tamper" } }),
    ).rejects.toThrow(/append-only/);
    expect(await reconcile()).toMatchObject({ ok: true, issued: 4, held: 4 });
  });

  it("allows only one of two concurrent transfers of the same holding", async () => {
    const project = await makeProject();
    await issue(project.id, 40);
    const fromAccountId = await inventoryId();
    const results = await Promise.allSettled([
      transferCredits({
        fromAccountId,
        toAccountId: holderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        quantity: 40,
        actorId: adminId,
      }),
      transferCredits({
        fromAccountId,
        toAccountId: otherHolderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        quantity: 40,
        actorId: adminId,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const held = (await listHoldings()).reduce((sum, row) => sum + row.quantity, 0);
    expect(held).toBe(40);
    expect(await reconcile()).toMatchObject({ ok: true, issued: 40, held: 40 });
  });
});
