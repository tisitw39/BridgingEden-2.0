import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { LedgerError } from "@/lib/ledger/errors";

export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (isRedirectError(error)) throw error;
  if (error instanceof LedgerError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? fallback;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "That value is already in use.";
  }
  return fallback;
}

export function flashRedirect(path: string, kind: "error" | "notice", message: string): never {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(kind, message);
  redirect(`${pathname}?${params.toString()}`);
}
