import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { buildRetirementCertificate } from "@/lib/certificate";
import { listHoldings } from "@/lib/ledger/queries";
import { loadRetirementByToken, loadRetirementVerification } from "@/lib/verify";
import { ownerPrisma } from "./owner-db";
import { resetTransactionalData } from "./reset-db";
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
let approverId = "";
let holderId = "";
let holderAccountId = "";
let otherHolderAccountId = "";

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
  return approveBatch(batch.id, approverId);
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
    const admin = await ownerPrisma.user.upsert({
      where: { email: "ledger-admin@test.local" },
      update: { role: "ADMIN" },
      create: {
        email: "ledger-admin@test.local",
        name: "Ledger Admin",
        passwordHash,
        role: "ADMIN",
      },
    });
    const approver = await ownerPrisma.user.upsert({
      where: { email: "ledger-approver@test.local" },
      update: { role: "ADMIN" },
      create: {
        email: "ledger-approver@test.local",
        name: "Ledger Approver",
        passwordHash,
        role: "ADMIN",
      },
    });
    const holder = await ownerPrisma.user.upsert({
      where: { email: "ledger-holder@test.local" },
      update: { role: "HOLDER" },
      create: {
        email: "ledger-holder@test.local",
        name: "Ledger Holder",
        passwordHash,
        role: "HOLDER",
      },
    });
    const other = await ownerPrisma.user.upsert({
      where: { email: "ledger-other@test.local" },
      update: { role: "HOLDER" },
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
    approverId = approver.id;
    holderId = holder.id;
    holderAccountId = holderAccount.id;
    otherHolderAccountId = otherAccount.id;
  });

  beforeEach(async () => {
    await resetTransactionalData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
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
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(prisma.ledgerPosting.delete({ where: { id: posting.id } })).rejects.toThrow(
      /permission denied|append-only/,
    );
    await expect(prisma.ledgerEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /permission denied|append-only/,
    );
    await expect(
      prisma.auditLog.update({ where: { id: audit.id }, data: { action: "tamper" } }),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(
      ownerPrisma.ledgerPosting.update({ where: { id: posting.id }, data: { quantity: 1 } }),
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

  it("requires a different admin to approve a draft", async () => {
    const project = await makeProject("EYES");
    const draft = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 12,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await expect(approveBatch(draft.id, adminId)).rejects.toThrow(/different admin/);
    const issued = await approveBatch(draft.id, approverId);
    expect(issued).toMatchObject({ serialStart: 1, serialEnd: 12, quantity: 12 });
    const row = await prisma.creditBatch.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.approvedById).toBe(approverId);
    expect(row.draftedById).toBe(adminId);
  });

  it("lets only one of approve or reject win a race", async () => {
    const project = await makeProject("RACE");
    const draft = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 9,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    const results = await Promise.allSettled([
      approveBatch(draft.id, approverId),
      rejectBatch(draft.id, adminId, "Superseded by a corrected boundary."),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const batch = await prisma.creditBatch.findUniqueOrThrow({ where: { id: draft.id } });
    const events = await prisma.ledgerEvent.count({ where: { projectId: project.id } });
    if (batch.status === "APPROVED") {
      expect(events).toBe(1);
      expect(batch.serialStart).toBe(1);
    } else {
      expect(batch.status).toBe("REJECTED");
      expect(events).toBe(0);
    }
    expect((await reconcile()).ok).toBe(true);
  });

  it("lets only one of retire or transfer spend the same holding", async () => {
    const project = await makeProject("SPEND");
    await issue(project.id, 10);
    await transferCredits({
      fromAccountId: await inventoryId(),
      toAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 10,
      actorId: adminId,
    });
    const results = await Promise.allSettled([
      retireCredits({
        fromAccountId: holderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        quantity: 10,
        beneficiary: "Northwind Office Ltd",
        reason: "Annual inventory",
        actorId: holderId,
      }),
      transferCredits({
        fromAccountId: holderAccountId,
        toAccountId: otherHolderAccountId,
        projectId: project.id,
        vintageYear: 2024,
        quantity: 10,
        actorId: adminId,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const held = (await listHoldings()).reduce((sum, row) => sum + row.quantity, 0);
    const reconciliation = await reconcile();
    expect(reconciliation.ok).toBe(true);
    expect(reconciliation.issued).toBe(10);
    expect(held + reconciliation.retired).toBe(10);
    expect(reconciliation.held).toBe(held);
  });

  it("rejects text that exceeds the ledger limits", async () => {
    const project = await makeProject("LONG");
    await issue(project.id, 4);
    await expect(
      retireCredits({
        fromAccountId: await inventoryId(),
        projectId: project.id,
        vintageYear: 2024,
        quantity: 1,
        beneficiary: "N".repeat(201),
        reason: "A reason",
        actorId: holderId,
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("builds a multi-page certificate that can be verified in public", async () => {
    const project = await makeProject("CERT");
    await issue(project.id, 6);
    await transferCredits({
      fromAccountId: await inventoryId(),
      toAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 6,
      actorId: adminId,
    });
    const retired = await retireCredits({
      fromAccountId: holderAccountId,
      projectId: project.id,
      vintageYear: 2024,
      quantity: 2,
      beneficiary: "Córas – Northwind",
      reason: "word ".repeat(400),
      actorId: holderId,
    });
    const pdf = await buildRetirementCertificate(retired.eventId);
    expect(pdf).toBeTruthy();
    const document = await PDFDocument.load(pdf!);
    expect(document.getPageCount()).toBeGreaterThan(1);
    const stored = await prisma.retirementVerification.findUniqueOrThrow({ where: { eventId: retired.eventId } });
    expect(stored.token).toMatch(/^[a-f0-9]{32}$/);
    const verified = await loadRetirementByToken(stored.token);
    expect(verified).toMatchObject({
      status: "Retired",
      projectCode: "CERT",
      vintageYear: 2024,
      quantity: 2,
      beneficiary: "Córas – Northwind",
    });
    expect(verified?.serials[0]).toContain("–");
    expect(await loadRetirementByToken(retired.eventId)).toBeNull();
    expect((await loadRetirementVerification(retired.eventId))?.verificationToken).toBe(stored.token);
    await expect(
      prisma.$executeRaw`UPDATE retirement_verifications SET token = ${"ab".repeat(16)} WHERE event_id = ${retired.eventId}`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      ownerPrisma.$executeRaw`UPDATE retirement_verifications SET token = ${"cd".repeat(16)} WHERE event_id = ${retired.eventId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects a contra issuance that is not tied to an approved batch", async () => {
    const project = await makeProject("MINT");
    const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
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
            accountId: inventory.id,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 5,
            quantity: 5,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: issuance.id,
            side: "CREDIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 5,
            quantity: 5,
          },
        });
      }),
    ).rejects.toThrow(/approved credit batch/);
    expect(await prisma.issuedSerialRange.count()).toBe(0);
  });

  it("rejects self-approval and limits batch updates to approval columns", async () => {
    const project = await makeProject("EYES");
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 5,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await expect(
      prisma.$executeRaw`
        UPDATE credit_batches
        SET status = 'APPROVED',
            serial_start = 1,
            serial_end = 5,
            approved_by_id = ${adminId},
            approved_at = NOW()
        WHERE id = ${batch.id}
      `,
    ).rejects.toThrow(/credit_batches_four_eyes/);
    await expect(
      prisma.$executeRaw`UPDATE credit_batches SET quantity = 9 WHERE id = ${batch.id}`,
    ).rejects.toThrow(/permission denied/);
    const columns = await prisma.$queryRaw<{ attname: string }[]>`
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'credit_batches'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND has_column_privilege(current_user, a.attrelid, a.attname, 'UPDATE')
      ORDER BY a.attname
    `;
    expect(columns.map((column) => column.attname)).toEqual([
      "approved_at",
      "approved_by_id",
      "rejected_at",
      "rejected_by_id",
      "rejection_note",
      "serial_end",
      "serial_start",
      "status",
    ]);
  });

  it("freezes a batch once it leaves draft", async () => {
    const project = await makeProject("FROZEN");
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 3,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await approveBatch(batch.id, approverId);
    await expect(
      prisma.$executeRaw`UPDATE credit_batches SET rejection_note = 'later' WHERE id = ${batch.id}`,
    ).rejects.toThrow(/frozen/);
    await expect(
      ownerPrisma.$executeRaw`UPDATE credit_batches SET rejection_note = 'later' WHERE id = ${batch.id}`,
    ).rejects.toThrow(/frozen/);
  });

  it("rejects a batch inserted as approved, or approved without an issuance", async () => {
    const project = await makeProject("DRAFT");
    await expect(
      prisma.creditBatch.create({
        data: {
          projectId: project.id,
          vintageYear: 2024,
          quantity: 5,
          methodology: "Native Woodland Establishment",
          status: "APPROVED",
          serialStart: 1,
          serialEnd: 5,
          draftedById: adminId,
          approvedById: approverId,
          approvedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/unapproved draft/);

    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 5,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await expect(
      prisma.$executeRaw`
        UPDATE credit_batches
        SET status = 'APPROVED',
            serial_start = 1,
            serial_end = 5,
            approved_by_id = ${approverId},
            approved_at = NOW()
        WHERE id = ${batch.id}
      `,
    ).rejects.toThrow(/issuance event/);
    const stillDraft = await prisma.creditBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stillDraft.status).toBe("DRAFT");
  });

  it("rejects an approved batch whose postings do not match its quantity or serials", async () => {
    const project = await makeProject("MISMATCH");
    const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
    const issuance = await prisma.account.findUniqueOrThrow({ where: { code: "ISSUANCE" } });
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 5,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    const attempt = (serialStart: number, serialEnd: number) =>
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: approverId,
            batchId: batch.id,
          },
        });
        const quantity = serialEnd - serialStart + 1;
        for (const side of ["DEBIT", "CREDIT"] as const) {
          await tx.ledgerPosting.create({
            data: {
              eventId: event.id,
              accountId: side === "DEBIT" ? inventory.id : issuance.id,
              side,
              projectId: project.id,
              vintageYear: 2024,
              serialStart,
              serialEnd,
              quantity,
            },
          });
        }
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: {
            status: "APPROVED",
            serialStart: 1,
            serialEnd: 5,
            approvedById: approverId,
            approvedAt: new Date(),
          },
        });
      });
    await expect(attempt(1, 4)).rejects.toThrow(/do not match the approved batch/);
    await expect(attempt(2, 6)).rejects.toThrow(/do not match the approved batch/);
    expect(await prisma.issuedSerialRange.count()).toBe(0);
  });

  it("rejects an issuance whose actor is not the approving admin", async () => {
    const project = await makeProject("ACTOR");
    const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
    const issuance = await prisma.account.findUniqueOrThrow({ where: { code: "ISSUANCE" } });
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 2,
      methodology: "Native Woodland Establishment",
      actorId: adminId,
    });
    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: adminId,
            batchId: batch.id,
          },
        });
        for (const side of ["DEBIT", "CREDIT"] as const) {
          await tx.ledgerPosting.create({
            data: {
              eventId: event.id,
              accountId: side === "DEBIT" ? inventory.id : issuance.id,
              side,
              projectId: project.id,
              vintageYear: 2024,
              serialStart: 1,
              serialEnd: 2,
              quantity: 2,
            },
          });
        }
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: {
            status: "APPROVED",
            serialStart: 1,
            serialEnd: 2,
            approvedById: approverId,
            approvedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/issuance actor must be the batch approver/);

    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: holderId,
            batchId: batch.id,
          },
        });
        for (const side of ["DEBIT", "CREDIT"] as const) {
          await tx.ledgerPosting.create({
            data: {
              eventId: event.id,
              accountId: side === "DEBIT" ? inventory.id : issuance.id,
              side,
              projectId: project.id,
              vintageYear: 2024,
              serialStart: 1,
              serialEnd: 2,
              quantity: 2,
            },
          });
        }
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: {
            status: "APPROVED",
            serialStart: 1,
            serialEnd: 2,
            approvedById: holderId,
            approvedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/batch approver must be an admin/);
  });

  it("rejects an issuance whose drafter is not an admin", async () => {
    const project = await makeProject("DRAFTER");
    const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
    const issuance = await prisma.account.findUniqueOrThrow({ where: { code: "ISSUANCE" } });
    const batch = await draftBatch({
      projectId: project.id,
      vintageYear: 2024,
      quantity: 2,
      methodology: "Native Woodland Establishment",
      actorId: holderId,
    });
    await expect(
      prisma.$transaction(async (tx) => {
        const event = await tx.ledgerEvent.create({
          data: {
            type: "ISSUANCE",
            projectId: project.id,
            vintageYear: 2024,
            actorId: approverId,
            batchId: batch.id,
          },
        });
        for (const side of ["DEBIT", "CREDIT"] as const) {
          await tx.ledgerPosting.create({
            data: {
              eventId: event.id,
              accountId: side === "DEBIT" ? inventory.id : issuance.id,
              side,
              projectId: project.id,
              vintageYear: 2024,
              serialStart: 1,
              serialEnd: 2,
              quantity: 2,
            },
          });
        }
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: {
            status: "APPROVED",
            serialStart: 1,
            serialEnd: 2,
            approvedById: approverId,
            approvedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/drafter must be an admin/);
  });

  it("rejects a contra credit or debit on a transfer", async () => {
    const project = await makeProject("CONTRA");
    const issuance = await prisma.account.findUniqueOrThrow({ where: { code: "ISSUANCE" } });
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
            accountId: holderAccountId,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 1,
            quantity: 1,
          },
        });
        await tx.ledgerPosting.create({
          data: {
            eventId: event.id,
            accountId: issuance.id,
            side: "CREDIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 1,
            quantity: 1,
          },
        });
      }),
    ).rejects.toThrow(/contra credit is only allowed on an issuance/);

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
            accountId: issuance.id,
            side: "DEBIT",
            projectId: project.id,
            vintageYear: 2024,
            serialStart: 1,
            serialEnd: 1,
            quantity: 1,
          },
        });
      }),
    ).rejects.toThrow(/only be debited by an issuance/);
  });
});
