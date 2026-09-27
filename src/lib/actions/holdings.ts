"use server";

import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorCode, flashRedirect, isRedirectError } from "@/lib/http";
import { LIMITS } from "@/lib/limits";
import { BCRYPT_COST } from "@/lib/passwords";
import { weakPasswordMessage } from "@/lib/weak-passwords";
import { ensureHolderAccount, cancelCredits, transferCredits } from "@/lib/ledger/service";
import { requireAdmin } from "@/lib/session";

const holderSchema = z.object({
  name: z.string().trim().min(2, "Enter the holder's name.").max(120),
  email: z.string().trim().email("Enter a valid email.").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Use a password of at least 8 characters.").max(LIMITS.password),
});

const memoSchema = z.string().trim().max(LIMITS.memo);
const reasonSchema = z.string().trim().min(2).max(LIMITS.reason);

function movement(formData: FormData) {
  const start = String(formData.get("serialStart") ?? "").trim();
  const end = String(formData.get("serialEnd") ?? "").trim();
  if (start || end) {
    return { serialStart: Number(start), serialEnd: Number(end) };
  }
  return { quantity: Number(String(formData.get("quantity") ?? "").trim()) };
}

export async function createHolderAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = holderSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    flashRedirect("/admin/holdings", "error", errorCode(parsed.error, "form_invalid"));
  }
  if (weakPasswordMessage(parsed.data.password)) {
    flashRedirect("/admin/holdings", "error", "password_weak");
  }
  try {
    const passwordHash = await hash(parsed.data.password, BCRYPT_COST);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: "HOLDER",
      },
    });
    await ensureHolderAccount(prisma, user);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "holder.created",
        entityType: "User",
        entityId: user.id,
        detail: { email: user.email, name: user.name },
      },
    });
    flashRedirect("/admin/holdings", "notice", "holder_created");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorCode(error, "holder_failed"));
  }
}

export async function transferAction(formData: FormData) {
  const admin = await requireAdmin();
  const memo = memoSchema.safeParse(String(formData.get("memo") ?? ""));
  if (!memo.success) flashRedirect("/admin/holdings", "error", errorCode(memo.error, "form_invalid"));
  try {
    await transferCredits({
      fromAccountId: String(formData.get("fromAccountId") ?? ""),
      toAccountId: String(formData.get("toAccountId") ?? ""),
      projectId: String(formData.get("projectId") ?? ""),
      vintageYear: Number(String(formData.get("vintageYear") ?? "").trim()),
      actorId: admin.id,
      memo: memo.data || undefined,
      ...movement(formData),
    });
    flashRedirect("/admin/holdings", "notice", "transferred");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorCode(error, "transfer_failed"));
  }
}

export async function cancelAction(formData: FormData) {
  const admin = await requireAdmin();
  const reason = reasonSchema.safeParse(formData.get("reason"));
  if (!reason.success) flashRedirect("/admin/holdings", "error", errorCode(reason.error, "form_invalid"));
  try {
    await cancelCredits({
      fromAccountId: String(formData.get("fromAccountId") ?? ""),
      projectId: String(formData.get("projectId") ?? ""),
      vintageYear: Number(String(formData.get("vintageYear") ?? "").trim()),
      reason: reason.data,
      actorId: admin.id,
      ...movement(formData),
    });
    flashRedirect("/admin/holdings", "notice", "cancelled");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorCode(error, "cancel_failed"));
  }
}
