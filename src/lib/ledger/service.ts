import { randomBytes } from "node:crypto";
import { Prisma, type LedgerEventType, type PostingSide } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/errors";
import { LIMITS } from "@/lib/limits";
import {
  allocateQuantity,
  deriveHoldings,
  mergeRanges,
  quantityOf,
  sliceExact,
  type PostingView,
  type SerialRange,
} from "@/lib/ledger/ranges";

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

export const SYSTEM_ACCOUNTS = [
  { code: "INVENTORY", name: "Bridging Eden inventory", kind: "ASSET" as const },
  { code: "ISSUANCE", name: "Credits issued", kind: "CONTRA" as const },
  { code: "RETIREMENT", name: "Retired credits", kind: "SINK" as const },
  { code: "CANCELLATION", name: "Cancelled credits", kind: "SINK" as const },
];

export async function ensureSystemAccounts(client: Tx | Prisma.TransactionClient | typeof prisma = prisma) {
  for (const account of SYSTEM_ACCOUNTS) {
    await client.account.upsert({
      where: { code: account.code },
      update: { name: account.name },
      create: account,
    });
  }
}

export async function ensureHolderAccount(
  client: Tx | typeof prisma,
  user: { id: string; name: string },
) {
  return client.account.upsert({
    where: { userId: user.id },
    update: { name: user.name },
    create: {
      code: `HOLDER:${user.id}`,
      name: user.name,
      kind: "ASSET",
      userId: user.id,
    },
  });
}

function rethrow(error: unknown): never {
  if (error instanceof LedgerError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("uncovered credit")) {
    throw new LedgerError("That serial range is not fully held.", "INSUFFICIENT");
  }
  if (
    message.includes("issued_serials_do_not_overlap") ||
    message.includes("exclusion constraint")
  ) {
    throw new LedgerError("Those serial numbers overlap an existing issuance.", "OVERLAP");
  }
  if (
    message.includes("append-only") ||
    message.includes("unbalanced ledger event") ||
    message.includes("approved credit batch") ||
    message.includes("do not match the approved batch") ||
    message.includes("is frozen") ||
    message.includes("credit_batches_four_eyes")
  ) {
    throw new LedgerError("The ledger rejected this entry.", "INVARIANT");
  }
  throw error;
}

async function lockHold(tx: Tx, accountId: string, projectId: string, vintageYear: number) {
  const key = `${accountId}:${projectId}:${vintageYear}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

async function lockIssue(tx: Tx, projectId: string) {
  const key = `issue:${projectId}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

async function systemAccount(tx: Tx, code: string) {
  const account = await tx.account.findUnique({ where: { code } });
  if (!account) throw new LedgerError(`System account ${code} is missing.`, "INVARIANT");
  return account;
}

async function holdingsFor(
  tx: Tx,
  accountId: string,
  projectId: string,
  vintageYear: number,
): Promise<SerialRange[]> {
  const postings = await tx.ledgerPosting.findMany({
    where: { accountId, projectId, vintageYear },
    select: {
      side: true,
      projectId: true,
      vintageYear: true,
      serialStart: true,
      serialEnd: true,
    },
  });
  const derived = deriveHoldings(postings as PostingView[]);
  return derived.get(`${projectId}:${vintageYear}`) ?? [];
}

function resolveSlices(
  holdings: SerialRange[],
  input: { quantity?: number; serialStart?: number; serialEnd?: number },
): SerialRange[] {
  const hasQuantity = input.quantity !== undefined;
  const hasRange = input.serialStart !== undefined || input.serialEnd !== undefined;
  if (hasQuantity === hasRange) {
    throw new LedgerError("Provide a quantity or a serial range.", "INVALID");
  }
  if (hasRange) {
    return sliceExact(holdings, input.serialStart ?? NaN, input.serialEnd ?? NaN);
  }
  return allocateQuantity(holdings, input.quantity ?? 0);
}

async function addPosting(
  tx: Tx,
  input: {
    eventId: string;
    accountId: string;
    side: PostingSide;
    projectId: string;
    vintageYear: number;
    range: SerialRange;
  },
) {
  const quantity = input.range.end - input.range.start + 1;
  return tx.ledgerPosting.create({
    data: {
      eventId: input.eventId,
      accountId: input.accountId,
      side: input.side,
      projectId: input.projectId,
      vintageYear: input.vintageYear,
      serialStart: input.range.start,
      serialEnd: input.range.end,
      quantity,
    },
  });
}

async function postMove(
  tx: Tx,
  input: {
    type: LedgerEventType;
    projectId: string;
    vintageYear: number;
    actorId: string;
    memo?: string;
    beneficiary?: string;
    reason?: string;
    batchId?: string;
    fromAccountId: string;
    toAccountId: string;
    ranges: SerialRange[];
  },
) {
  if (input.ranges.length === 0) {
    throw new LedgerError("Nothing to post.", "INVALID");
  }
  if (input.memo && input.memo.length > LIMITS.memo) {
    throw new LedgerError(`A memo must be ${LIMITS.memo} characters or fewer.`, "INVALID");
  }
  if (input.beneficiary && input.beneficiary.length > LIMITS.beneficiary) {
    throw new LedgerError(`A beneficiary must be ${LIMITS.beneficiary} characters or fewer.`, "INVALID");
  }
  if (input.reason && input.reason.length > LIMITS.reason) {
    throw new LedgerError(`A reason must be ${LIMITS.reason} characters or fewer.`, "INVALID");
  }
  const event = await tx.ledgerEvent.create({
    data: {
      type: input.type,
      projectId: input.projectId,
      vintageYear: input.vintageYear,
      actorId: input.actorId,
      memo: input.memo,
      beneficiary: input.beneficiary,
      reason: input.reason,
      batchId: input.batchId,
      verificationToken: input.type === "RETIREMENT" ? randomBytes(16).toString("hex") : null,
    },
  });
  for (const range of input.ranges) {
    await addPosting(tx, {
      eventId: event.id,
      accountId: input.toAccountId,
      side: "DEBIT",
      projectId: input.projectId,
      vintageYear: input.vintageYear,
      range,
    });
    await addPosting(tx, {
      eventId: event.id,
      accountId: input.fromAccountId,
      side: "CREDIT",
      projectId: input.projectId,
      vintageYear: input.vintageYear,
      range,
    });
  }
  return event;
}

async function writeAudit(
  tx: Tx,
  input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    detail: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      detail: input.detail,
    },
  });
}

function assertVintage(vintageYear: number) {
  if (!Number.isInteger(vintageYear) || vintageYear < 1990 || vintageYear > 2100) {
    throw new LedgerError("Vintage year must be between 1990 and 2100.", "INVALID");
  }
}

function assertQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000_000) {
    throw new LedgerError("Quantity must be a whole number of tonnes.", "INVALID");
  }
}

function bounded(value: string, max: number, label: string, min = 0): string {
  const trimmed = value.trim();
  if (trimmed.length < min) throw new LedgerError(`${label} is required.`, "INVALID");
  if (trimmed.length > max) {
    throw new LedgerError(`${label} must be ${max} characters or fewer.`, "INVALID");
  }
  return trimmed;
}

export async function draftBatch(input: {
  projectId: string;
  vintageYear: number;
  quantity: number;
  methodology: string;
  actorId: string;
}) {
  assertVintage(input.vintageYear);
  assertQuantity(input.quantity);
  const methodology = bounded(input.methodology, LIMITS.methodology, "Methodology", 3);
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new LedgerError("Project not found.", "NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const batch = await tx.creditBatch.create({
      data: {
        projectId: project.id,
        vintageYear: input.vintageYear,
        quantity: input.quantity,
        methodology,
        status: "DRAFT",
        draftedById: input.actorId,
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "batch.drafted",
      entityType: "CreditBatch",
      entityId: batch.id,
      detail: {
        projectId: project.id,
        vintageYear: input.vintageYear,
        quantity: input.quantity,
        methodology,
      },
    });
    return batch;
  });
}

export async function approveBatch(batchId: string, actorId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.creditBatch.findUnique({ where: { id: batchId } });
      if (!existing) throw new LedgerError("Batch not found.", "NOT_FOUND");
      if (existing.status !== "DRAFT") {
        throw new LedgerError("Only a draft batch can be approved.", "INVALID");
      }
      await lockIssue(tx, existing.projectId);
      const batch = await tx.creditBatch.findUnique({ where: { id: batchId } });
      if (!batch || batch.status !== "DRAFT") {
        throw new LedgerError("Only a draft batch can be approved.", "INVALID");
      }
      if (batch.draftedById === actorId) {
        throw new LedgerError("A different admin must approve this draft.", "INVALID");
      }

      const max = await tx.issuedSerialRange.aggregate({
        where: { projectId: batch.projectId },
        _max: { serialEnd: true },
      });
      const serialStart = (max._max.serialEnd ?? 0) + 1;
      const serialEnd = serialStart + batch.quantity - 1;
      const inventory = await systemAccount(tx, "INVENTORY");
      const issuance = await systemAccount(tx, "ISSUANCE");

      const event = await postMove(tx, {
        type: "ISSUANCE",
        projectId: batch.projectId,
        vintageYear: batch.vintageYear,
        actorId,
        memo: `Issuance of ${batch.quantity} tCO2e, vintage ${batch.vintageYear}`,
        batchId: batch.id,
        fromAccountId: issuance.id,
        toAccountId: inventory.id,
        ranges: [{ start: serialStart, end: serialEnd }],
      });

      const updated = await tx.creditBatch.updateMany({
        where: { id: batch.id, status: "DRAFT" },
        data: {
          status: "APPROVED",
          serialStart,
          serialEnd,
          approvedById: actorId,
          approvedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new LedgerError("Only a draft batch can be approved.", "INVALID");
      }
      await writeAudit(tx, {
        actorId,
        action: "batch.approved",
        entityType: "CreditBatch",
        entityId: batch.id,
        detail: { serialStart, serialEnd, eventId: event.id, quantity: batch.quantity },
      });
      return { eventId: event.id, serialStart, serialEnd, quantity: batch.quantity };
    }, TX_OPTIONS);
  } catch (error) {
    rethrow(error);
  }
}

export async function rejectBatch(batchId: string, actorId: string, note: string) {
  const rejectionNote = bounded(note, LIMITS.rejectionNote, "A rejection note", 3);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.creditBatch.findUnique({ where: { id: batchId } });
      if (!existing) throw new LedgerError("Batch not found.", "NOT_FOUND");
      await lockIssue(tx, existing.projectId);
      const updated = await tx.creditBatch.updateMany({
        where: { id: batchId, status: "DRAFT" },
        data: {
          status: "REJECTED",
          rejectedById: actorId,
          rejectedAt: new Date(),
          rejectionNote,
        },
      });
      if (updated.count !== 1) {
        throw new LedgerError("Only a draft batch can be rejected.", "INVALID");
      }
      await writeAudit(tx, {
        actorId,
        action: "batch.rejected",
        entityType: "CreditBatch",
        entityId: batchId,
        detail: { rejectionNote },
      });
    }, TX_OPTIONS);
  } catch (error) {
    rethrow(error);
  }
}

type MoveInput = {
  fromAccountId: string;
  projectId: string;
  vintageYear: number;
  actorId: string;
  quantity?: number;
  serialStart?: number;
  serialEnd?: number;
  memo?: string;
};

async function moveFromAsset(
  input: MoveInput & {
    type: "TRANSFER" | "RETIREMENT" | "CANCELLATION";
    toAccountId: string;
    beneficiary?: string;
    reason?: string;
    auditAction: string;
  },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockHold(tx, input.fromAccountId, input.projectId, input.vintageYear);
      const from = await tx.account.findUnique({ where: { id: input.fromAccountId } });
      const to = await tx.account.findUnique({ where: { id: input.toAccountId } });
      if (!from || !to) throw new LedgerError("Account not found.", "NOT_FOUND");
      if (from.kind !== "ASSET") {
        throw new LedgerError("Credits can only leave a holding account.", "INVALID");
      }
      if (input.type === "TRANSFER" && to.kind !== "ASSET") {
        throw new LedgerError("Transfers move credits between holding accounts.", "INVALID");
      }
      if (input.type === "TRANSFER" && from.id === to.id) {
        throw new LedgerError("Choose two different accounts.", "INVALID");
      }
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new LedgerError("Project not found.", "NOT_FOUND");
      assertVintage(input.vintageYear);

      const holdings = await holdingsFor(tx, from.id, input.projectId, input.vintageYear);
      const ranges = resolveSlices(holdings, input);
      const event = await postMove(tx, {
        type: input.type,
        projectId: input.projectId,
        vintageYear: input.vintageYear,
        actorId: input.actorId,
        memo: input.memo,
        beneficiary: input.beneficiary,
        reason: input.reason,
        fromAccountId: from.id,
        toAccountId: to.id,
        ranges,
      });
      await writeAudit(tx, {
        actorId: input.actorId,
        action: input.auditAction,
        entityType: "LedgerEvent",
        entityId: event.id,
        detail: {
          type: input.type,
          projectId: input.projectId,
          vintageYear: input.vintageYear,
          fromAccountId: from.id,
          toAccountId: to.id,
          ranges,
          quantity: quantityOf(ranges),
          beneficiary: input.beneficiary ?? null,
          reason: input.reason ?? null,
        },
      });
      return { eventId: event.id, ranges, quantity: quantityOf(ranges) };
    }, TX_OPTIONS);
  } catch (error) {
    rethrow(error);
  }
}

export async function transferCredits(
  input: MoveInput & { toAccountId: string; memo?: string },
) {
  const memo = input.memo === undefined ? undefined : bounded(input.memo, LIMITS.memo, "A memo");
  return moveFromAsset({
    ...input,
    memo: memo || undefined,
    type: "TRANSFER",
    auditAction: "ledger.transfer",
  });
}

export async function retireCredits(
  input: MoveInput & { beneficiary: string; reason: string },
) {
  const beneficiary = bounded(input.beneficiary, LIMITS.beneficiary, "A beneficiary", 2);
  const reason = bounded(input.reason, LIMITS.reason, "A retirement reason", 2);
  const retirement = await prisma.account.findUnique({ where: { code: "RETIREMENT" } });
  if (!retirement) throw new LedgerError("Retirement account is missing.", "INVARIANT");
  return moveFromAsset({
    ...input,
    beneficiary,
    reason,
    toAccountId: retirement.id,
    type: "RETIREMENT",
    memo: `Retired for ${beneficiary}`,
    auditAction: "ledger.retirement",
  });
}

export async function cancelCredits(input: MoveInput & { reason: string }) {
  const reason = bounded(input.reason, LIMITS.reason, "A cancellation reason", 2);
  const cancellation = await prisma.account.findUnique({ where: { code: "CANCELLATION" } });
  if (!cancellation) throw new LedgerError("Cancellation account is missing.", "INVARIANT");
  return moveFromAsset({
    ...input,
    reason,
    toAccountId: cancellation.id,
    type: "CANCELLATION",
    memo: reason.slice(0, LIMITS.memo),
    auditAction: "ledger.cancellation",
  });
}

export type Reconciliation = {
  ok: boolean;
  issued: number;
  held: number;
  retired: number;
  cancelled: number;
};

export async function reconcile(client: Tx | typeof prisma = prisma): Promise<Reconciliation> {
  const accounts = await client.account.findMany();
  const postings = await client.ledgerPosting.findMany({
    select: {
      accountId: true,
      side: true,
      projectId: true,
      vintageYear: true,
      serialStart: true,
      serialEnd: true,
    },
  });
  const issuedRows = await client.issuedSerialRange.findMany();

  const byAccount = new Map<string, PostingView[]>();
  for (const posting of postings) {
    const list = byAccount.get(posting.accountId) ?? [];
    list.push({
      side: posting.side,
      projectId: posting.projectId,
      vintageYear: posting.vintageYear,
      serialStart: posting.serialStart,
      serialEnd: posting.serialEnd,
    });
    byAccount.set(posting.accountId, list);
  }

  let held = 0;
  let retired = 0;
  let cancelled = 0;
  const netByProject = new Map<string, SerialRange[]>();

  for (const account of accounts) {
    if (account.kind === "CONTRA") continue;
    const derived = deriveHoldings(byAccount.get(account.id) ?? []);
    for (const [key, ranges] of derived) {
      const quantity = quantityOf(ranges);
      if (account.kind === "ASSET") held += quantity;
      else if (account.code === "RETIREMENT") retired += quantity;
      else if (account.code === "CANCELLATION") cancelled += quantity;
      const projectId = key.slice(0, key.lastIndexOf(":"));
      const bucket = netByProject.get(projectId) ?? [];
      bucket.push(...ranges);
      netByProject.set(projectId, bucket);
    }
  }

  const issuedByProject = new Map<string, number>();
  let issued = 0;
  for (const row of issuedRows) {
    const quantity = row.serialEnd - row.serialStart + 1;
    issued += quantity;
    issuedByProject.set(row.projectId, (issuedByProject.get(row.projectId) ?? 0) + quantity);
  }

  let overlap = false;
  for (const ranges of netByProject.values()) {
    if (quantityOf(ranges) !== quantityOf(mergeRanges(ranges))) overlap = true;
  }

  let conserved = true;
  const projectIds = new Set([...issuedByProject.keys(), ...netByProject.keys()]);
  for (const projectId of projectIds) {
    const net = quantityOf(netByProject.get(projectId) ?? []);
    if (net !== (issuedByProject.get(projectId) ?? 0)) conserved = false;
  }

  const summed = held + retired + cancelled === issued;
  return { ok: overlap === false && conserved && summed, issued, held, retired, cancelled };
}
