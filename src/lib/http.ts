import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ERRORS, NOTICES, type ErrorCode, type NoticeCode } from "@/lib/flash";
import { LedgerError } from "@/lib/ledger/errors";

const LEDGER_CODES: Record<string, ErrorCode> = {
  INSUFFICIENT: "insufficient",
  OVERLAP: "overlap",
  NOT_FOUND: "not_found",
  INVALID: "invalid",
  INVARIANT: "invariant",
  DRAFT_ONLY: "draft_only",
  ISSUANCE_EVENT: "issuance_event",
  CONTRA_CREDIT: "contra_credit",
  ISSUANCE_ACTOR: "issuance_actor",
  APPROVER_ROLE: "approver_role",
  DRAFTER_ROLE: "drafter_role",
  CONTRA_DEBIT: "contra_debit",
  BATCH_MISMATCH: "batch_mismatch",
  BATCH_FROZEN: "batch_frozen",
};

export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function errorCode(error: unknown, fallback: ErrorCode): ErrorCode {
  if (isRedirectError(error)) throw error;
  if (error instanceof LedgerError) return LEDGER_CODES[error.code] ?? fallback;
  if (error instanceof ZodError) {
    return error.issues.some((issue) => issue.code === "too_big") ? "text_too_long" : "form_invalid";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "already_used";
  }
  return fallback;
}

export function flashRedirect(path: string, kind: "error" | "notice", code: string): never {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (kind === "notice") {
    params.set("notice", code in NOTICES ? code : "saved");
  } else {
    params.set("error", code in ERRORS ? code : "form_invalid");
  }
  redirect(`${pathname}?${params.toString()}`);
}

export type { ErrorCode, NoticeCode };
