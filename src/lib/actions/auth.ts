"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { errorCode, flashRedirect, isRedirectError } from "@/lib/http";
import { LIMITS } from "@/lib/limits";
import { changePassword, revokeSessions } from "@/lib/passwords";
import { LedgerError } from "@/lib/ledger/errors";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type LoginState = { error?: string } | null;

const passwordSchema = z
  .string()
  .min(8, "Use a password of at least 8 characters.")
  .max(LIMITS.password, "That password is too long.");

function safeCallback(callbackUrl: string, fallback: string) {
  if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) return callbackUrl;
  try {
    const url = new URL(callbackUrl);
    if (url.pathname.startsWith("/")) return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "");
  const known = email ? await prisma.user.findUnique({ where: { email }, select: { role: true } }) : null;
  const fallback = known?.role === "ADMIN" ? "/admin" : "/portfolio";
  const redirectTo = safeCallback(callbackUrl, fallback);

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof AuthError) {
      return { error: "The email or password is incorrect." };
    }
    throw error;
  }
  return null;
}

export async function signOutAction() {
  const user = await requireUser();
  await revokeSessions(user.id);
  await signOut({ redirectTo: "/" });
}

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({
      currentPassword: z.string().min(1).max(LIMITS.password),
      newPassword: passwordSchema,
      confirmPassword: z.string().min(1).max(LIMITS.password),
    })
    .safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
  if (!parsed.success) {
    flashRedirect("/account", "error", errorCode(parsed.error, "form_invalid"));
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    flashRedirect("/account", "error", "password_mismatch");
  }
  try {
    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    flashRedirect("/account", "notice", "password_changed");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof LedgerError && error.message.includes("current password")) {
      flashRedirect("/account", "error", "password_wrong");
    }
    if (error instanceof LedgerError && error.message.includes("different password")) {
      flashRedirect("/account", "error", "password_same");
    }
    flashRedirect("/account", "error", errorCode(error, "password_failed"));
  }
}
