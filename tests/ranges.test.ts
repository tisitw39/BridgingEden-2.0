import { describe, expect, it } from "vitest";
import { LedgerError } from "@/lib/ledger/errors";
import {
  allocateQuantity,
  deriveHoldings,
  deriveRanges,
  quantityOf,
  rangeCovered,
  type PostingView,
} from "@/lib/ledger/ranges";

function posting(
  side: "DEBIT" | "CREDIT",
  start: number,
  end: number,
  vintageYear = 2024,
): PostingView {
  return {
    side,
    projectId: "project",
    vintageYear,
    serialStart: start,
    serialEnd: end,
  };
}

describe("serial range allocation", () => {
  it("takes a partial quantity from the front of a holding and leaves the rest implied", () => {
    expect(allocateQuantity([{ start: 1, end: 1000 }], 250)).toEqual([{ start: 1, end: 250 }]);
  });

  it("splits the last range when a quantity spans several holdings", () => {
    expect(
      allocateQuantity(
        [
          { start: 1, end: 39 },
          { start: 61, end: 100 },
        ],
        50,
      ),
    ).toEqual([
      { start: 1, end: 39 },
      { start: 61, end: 71 },
    ]);
  });

  it("refuses a quantity larger than the holding", () => {
    expect(() => allocateQuantity([{ start: 1, end: 10 }], 11)).toThrow(LedgerError);
    try {
      allocateQuantity([{ start: 1, end: 10 }], 11);
    } catch (error) {
      expect(error).toMatchObject({ code: "INSUFFICIENT" });
    }
  });

  it("knows when a requested slice sits inside a holding", () => {
    const holdings = [
      { start: 1, end: 39 },
      { start: 61, end: 100 },
    ];
    expect(rangeCovered(holdings, { start: 70, end: 80 })).toBe(true);
    expect(rangeCovered(holdings, { start: 30, end: 70 })).toBe(false);
  });
});

describe("derived balances", () => {
  it("splits a range when the middle is credited away", () => {
    const ranges = deriveRanges([
      posting("DEBIT", 1, 100),
      posting("CREDIT", 40, 60),
    ]);
    expect(ranges).toEqual([
      { start: 1, end: 39 },
      { start: 61, end: 100 },
    ]);
    expect(quantityOf(ranges)).toBe(79);
  });

  it("restores a holding after a round trip", () => {
    const ranges = deriveRanges([
      posting("DEBIT", 1, 40),
      posting("CREDIT", 1, 40),
      posting("DEBIT", 1, 40),
    ]);
    expect(ranges).toEqual([{ start: 1, end: 40 }]);
  });

  it("merges adjacent slices into one holding", () => {
    expect(
      deriveRanges([posting("DEBIT", 1, 30), posting("DEBIT", 31, 60)]),
    ).toEqual([{ start: 1, end: 60 }]);
  });

  it("rejects a negative balance", () => {
    expect(() => deriveRanges([posting("DEBIT", 1, 10), posting("CREDIT", 1, 11)])).toThrow(
      LedgerError,
    );
  });

  it("rejects a serial that would be counted twice", () => {
    expect(() =>
      deriveRanges([posting("DEBIT", 1, 10), posting("DEBIT", 5, 12)]),
    ).toThrow(LedgerError);
  });

  it("keeps vintages apart", () => {
    const holdings = deriveHoldings([
      posting("DEBIT", 1, 10, 2024),
      posting("CREDIT", 1, 4, 2024),
      posting("DEBIT", 1, 5, 2025),
    ]);
    expect(holdings.get("project:2024")).toEqual([{ start: 5, end: 10 }]);
    expect(holdings.get("project:2025")).toEqual([{ start: 1, end: 5 }]);
  });
});
