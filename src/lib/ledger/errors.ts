export type LedgerErrorCode =
  | "INSUFFICIENT"
  | "OVERLAP"
  | "INVALID"
  | "INVARIANT"
  | "NOT_FOUND"
  | "DRAFT_ONLY"
  | "ISSUANCE_EVENT"
  | "CONTRA_CREDIT"
  | "ISSUANCE_ACTOR"
  | "APPROVER_ROLE"
  | "DRAFTER_ROLE"
  | "CONTRA_DEBIT"
  | "BATCH_MISMATCH"
  | "BATCH_FROZEN";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(message: string, code: LedgerErrorCode) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
