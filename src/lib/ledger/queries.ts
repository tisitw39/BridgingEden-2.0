import type { LedgerEventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deriveHoldings, quantityOf, type PostingView, type SerialRange } from "@/lib/ledger/ranges";

export type HoldingRow = {
  accountId: string;
  accountName: string;
  holderName: string | null;
  holderEmail: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  vintageYear: number;
  ranges: SerialRange[];
  quantity: number;
};

export async function listHoldings(accountId?: string): Promise<HoldingRow[]> {
  const accounts = await prisma.account.findMany({
    where: { kind: "ASSET", ...(accountId ? { id: accountId } : {}) },
    include: { user: { select: { name: true, email: true } } },
  });
  if (accounts.length === 0) return [];

  const postings = await prisma.ledgerPosting.findMany({
    where: { accountId: { in: accounts.map((account) => account.id) } },
    select: {
      accountId: true,
      side: true,
      projectId: true,
      vintageYear: true,
      serialStart: true,
      serialEnd: true,
    },
  });

  const projects = await prisma.project.findMany({
    select: { id: true, code: true, name: true },
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const postingsByAccount = new Map<string, PostingView[]>();
  for (const posting of postings) {
    const list = postingsByAccount.get(posting.accountId) ?? [];
    list.push(posting);
    postingsByAccount.set(posting.accountId, list);
  }

  const rows: HoldingRow[] = [];
  for (const account of accounts) {
    const derived = deriveHoldings(postingsByAccount.get(account.id) ?? []);
    for (const [key, ranges] of derived) {
      const quantity = quantityOf(ranges);
      if (quantity === 0) continue;
      const projectId = key.slice(0, key.lastIndexOf(":"));
      const vintageYear = Number(key.slice(key.lastIndexOf(":") + 1));
      const project = projectById.get(projectId);
      if (!project) continue;
      rows.push({
        accountId: account.id,
        accountName: account.name,
        holderName: account.user?.name ?? null,
        holderEmail: account.user?.email ?? null,
        projectId,
        projectCode: project.code,
        projectName: project.name,
        vintageYear,
        ranges,
        quantity,
      });
    }
  }

  rows.sort((a, b) => {
    const byHolder = (a.holderName ?? a.accountName).localeCompare(b.holderName ?? b.accountName);
    if (byHolder !== 0) return byHolder;
    const byProject = a.projectName.localeCompare(b.projectName);
    if (byProject !== 0) return byProject;
    return a.vintageYear - b.vintageYear;
  });
  return rows;
}

export async function listEvents(filters: {
  type?: LedgerEventType;
  projectId?: string;
  accountId?: string;
  vintageYear?: number;
}) {
  return prisma.ledgerEvent.findMany({
    where: {
      type: filters.type,
      projectId: filters.projectId,
      vintageYear: filters.vintageYear,
      ...(filters.accountId ? { postings: { some: { accountId: filters.accountId } } } : {}),
    },
    include: {
      actor: { select: { name: true, email: true } },
      project: { select: { code: true, name: true } },
      verification: { select: { token: true } },
      postings: {
        include: { account: { select: { name: true, code: true, kind: true } } },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 200,
  });
}

export function movementOf(event: {
  type: string;
  postings: { side: "DEBIT" | "CREDIT"; account: { name: string; kind: string }; serialStart: number; serialEnd: number; quantity: number }[];
}) {
  const credits = event.postings.filter((posting) => posting.side === "CREDIT");
  const debits = event.postings.filter((posting) => posting.side === "DEBIT");
  const ranges = credits.map((posting) => ({ start: posting.serialStart, end: posting.serialEnd }));
  const quantity = credits.reduce((sum, posting) => sum + posting.quantity, 0);
  if (event.type === "ISSUANCE") {
    return {
      from: "Issuance",
      to: debits.map((posting) => posting.account.name).join(", ") || "Inventory",
      ranges,
      quantity,
    };
  }
  return {
    from: uniqueNames(credits.map((posting) => posting.account.name)),
    to: uniqueNames(debits.map((posting) => posting.account.name)),
    ranges,
    quantity,
  };
}

function uniqueNames(names: string[]): string {
  return [...new Set(names)].join(", ");
}
