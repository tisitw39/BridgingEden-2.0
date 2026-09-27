"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorCode, flashRedirect, isRedirectError } from "@/lib/http";
import { LIMITS } from "@/lib/limits";
import { retireCredits } from "@/lib/ledger/service";
import { requireUser } from "@/lib/session";

const retireSchema = z.object({
  beneficiary: z.string().trim().min(2).max(LIMITS.beneficiary),
  reason: z.string().trim().min(2).max(LIMITS.reason),
});

export async function retireAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "HOLDER") {
    flashRedirect("/portfolio", "error", "retire_holder_only");
  }
  const account = await prisma.account.findUnique({ where: { userId: user.id } });
  if (!account) flashRedirect("/portfolio", "error", "retire_no_account");

  const parsed = retireSchema.safeParse({
    beneficiary: formData.get("beneficiary"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    flashRedirect("/portfolio", "error", errorCode(parsed.error, "form_invalid"));
  }

  const holding = String(formData.get("holding") ?? "");
  const [projectId, vintageRaw] = holding.split(":");
  const start = String(formData.get("serialStart") ?? "").trim();
  const end = String(formData.get("serialEnd") ?? "").trim();
  const slice =
    start || end
      ? { serialStart: Number(start), serialEnd: Number(end) }
      : { quantity: Number(String(formData.get("quantity") ?? "").trim()) };

  try {
    await retireCredits({
      fromAccountId: account!.id,
      projectId,
      vintageYear: Number(vintageRaw),
      beneficiary: parsed.data.beneficiary,
      reason: parsed.data.reason,
      actorId: user.id,
      ...slice,
    });
    flashRedirect("/portfolio", "notice", "retired");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/portfolio", "error", errorCode(error, "retire_failed"));
  }
}
