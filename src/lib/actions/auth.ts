"use server";

import { compare } from "bcryptjs";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isRedirectError } from "@/lib/http";

export type LoginState = { error?: string } | null;

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
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const valid = user ? await compare(password, user.passwordHash) : false;
  if (!user || !valid) {
    return { error: "The email or password is incorrect." };
  }

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      detail: { email: user.email },
    },
  });

  const fallback = user.role === "ADMIN" ? "/admin" : "/portfolio";
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
  await signOut({ redirectTo: "/" });
}
