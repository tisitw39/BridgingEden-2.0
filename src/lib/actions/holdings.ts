"use server";

import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorMessage, flashRedirect, isRedirectError } from "@/lib/http";
import { ensureHolderAccount, cancelCredits, transferCredits } from "@/lib/ledger/service";
import { requireAdmin } from "@/lib/session";

const holderSchema = z.object({
  name: z.string().trim().min(2, "Enter the holder's name.").max(120),
  email: z.string().trim().email("Enter a valid email.").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Use a password of at least 8 characters.").max(200),
});

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
    flashRedirect(
      "/admin/holdings",
      "error",
      parsed.error.issues[0]?.message ?? "Check the holder details.",
    );
  }
  try {
    const passwordHash = await hash(parsed.data.password, 10);
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
    flashRedirect("/admin/holdings", "notice", `Holder account created for ${user.email}.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorMessage(error, "The holder could not be created."));
  }
}

export async function transferAction(formData: FormData) {
  const admin = await requireAdmin();
  try {
    const result = await transferCredits({
      fromAccountId: String(formData.get("fromAccountId") ?? ""),
      toAccountId: String(formData.get("toAccountId") ?? ""),
      projectId: String(formData.get("projectId") ?? ""),
      vintageYear: Number(String(formData.get("vintageYear") ?? "").trim()),
      actorId: admin.id,
      memo: String(formData.get("memo") ?? "").trim() || undefined,
      ...movement(formData),
    });
    flashRedirect(
      "/admin/holdings",
      "notice",
      `Transferred ${result.quantity} tonnes.`,
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorMessage(error, "The transfer could not be posted."));
  }
}

export async function cancelAction(formData: FormData) {
  const admin = await requireAdmin();
  try {
    const result = await cancelCredits({
      fromAccountId: String(formData.get("fromAccountId") ?? ""),
      projectId: String(formData.get("projectId") ?? ""),
      vintageYear: Number(String(formData.get("vintageYear") ?? "").trim()),
      reason: String(formData.get("reason") ?? ""),
      actorId: admin.id,
      ...movement(formData),
    });
    flashRedirect("/admin/holdings", "notice", `Cancelled ${result.quantity} tonnes.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/holdings", "error", errorMessage(error, "The cancellation could not be posted."));
  }
}
