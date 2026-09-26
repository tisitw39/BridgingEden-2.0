export type LedgerErrorCode =
  | "INSUFFICIENT"
  | "OVERLAP"
  | "INVALID"
  | "INVARIANT"
  | "NOT_FOUND";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(message: string, code: LedgerErrorCode) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
