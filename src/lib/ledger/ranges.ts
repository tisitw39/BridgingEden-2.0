import { LedgerError } from "@/lib/ledger/errors";

export type SerialRange = {
  start: number;
  end: number;
};

export type PostingView = {
  side: "DEBIT" | "CREDIT";
  projectId: string;
  vintageYear: number;
  serialStart: number;
  serialEnd: number;
};

export function rangeQuantity(range: SerialRange): number {
  return range.end - range.start + 1;
}

export function quantityOf(ranges: SerialRange[]): number {
  return ranges.reduce((sum, range) => sum + rangeQuantity(range), 0);
}

export function mergeRanges(ranges: SerialRange[]): SerialRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SerialRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ start: range.start, end: range.end });
    } else if (range.end > last.end) {
      last.end = range.end;
    }
  }
  return merged;
}

export function rangeCovered(holdings: SerialRange[], need: SerialRange): boolean {
  let cursor = need.start;
  for (const holding of [...holdings].sort((a, b) => a.start - b.start)) {
    if (holding.end < cursor) continue;
    if (holding.start > cursor) return false;
    cursor = holding.end + 1;
    if (cursor > need.end) return true;
  }
  return cursor > need.end;
}

export function allocateQuantity(holdings: SerialRange[], quantity: number): SerialRange[] {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new LedgerError("Quantity must be a positive whole number of tonnes.", "INVALID");
  }
  const taken: SerialRange[] = [];
  let remaining = quantity;
  for (const holding of [...holdings].sort((a, b) => a.start - b.start)) {
    if (remaining === 0) break;
    const size = rangeQuantity(holding);
    if (size <= remaining) {
      taken.push({ start: holding.start, end: holding.end });
      remaining -= size;
    } else {
      taken.push({ start: holding.start, end: holding.start + remaining - 1 });
      remaining = 0;
    }
  }
  if (remaining > 0) {
    throw new LedgerError("That account does not hold enough credits.", "INSUFFICIENT");
  }
  return taken;
}

/**
 * End-state holdings for one account, project, and vintage.
 * A debit adds one count to every serial in the range. A credit removes one.
 * The result is the serials whose count is 1. A count below 0 or above 1
 * means the postings double-count a serial or spend one that is not held.
 */
export function deriveRanges(postings: PostingView[]): SerialRange[] {
  const points: { pos: number; delta: number }[] = [];
  for (const posting of postings) {
    const delta = posting.side === "DEBIT" ? 1 : -1;
    points.push({ pos: posting.serialStart, delta });
    points.push({ pos: posting.serialEnd + 1, delta: -delta });
  }
  points.sort((a, b) => a.pos - b.pos);

  const ranges: SerialRange[] = [];
  let running = 0;
  let openAt: number | null = null;
  let index = 0;

  while (index < points.length) {
    const pos = points[index].pos;
    let delta = 0;
    while (index < points.length && points[index].pos === pos) {
      delta += points[index].delta;
      index += 1;
    }

    if (openAt !== null && running > 0) {
      if (pos - 1 >= openAt) {
        ranges.push({ start: openAt, end: pos - 1 });
      }
      openAt = null;
    }

    running += delta;
    if (running < 0 || running > 1) {
      throw new LedgerError(
        "A serial range is double-counted or has a negative balance.",
        "INVARIANT",
      );
    }
    openAt = running > 0 ? pos : null;
  }

  if (running !== 0) {
    throw new LedgerError("Serial balances did not close.", "INVARIANT");
  }

  return mergeRanges(ranges);
}

export function deriveHoldings(postings: PostingView[]): Map<string, SerialRange[]> {
  const groups = new Map<string, PostingView[]>();
  for (const posting of postings) {
    const key = `${posting.projectId}:${posting.vintageYear}`;
    const list = groups.get(key) ?? [];
    list.push(posting);
    groups.set(key, list);
  }
  const holdings = new Map<string, SerialRange[]>();
  for (const [key, group] of groups) {
    holdings.set(key, deriveRanges(group));
  }
  return holdings;
}

export function sliceExact(holdings: SerialRange[], start: number, end: number): SerialRange[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || start < 1) {
    throw new LedgerError("Serial range is invalid.", "INVALID");
  }
  const slice = { start, end };
  if (!rangeCovered(holdings, slice)) {
    throw new LedgerError("That serial range is not fully held.", "INSUFFICIENT");
  }
  return [slice];
}
