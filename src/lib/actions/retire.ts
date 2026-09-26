"use server";

import { prisma } from "@/lib/db";
import { errorMessage, flashRedirect, isRedirectError } from "@/lib/http";
import { retireCredits } from "@/lib/ledger/service";
import { requireUser } from "@/lib/session";

export async function retireAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "HOLDER") {
    flashRedirect("/portfolio", "error", "Only a holder account can retire credits.");
  }
  const account = await prisma.account.findUnique({ where: { userId: user.id } });
  if (!account) flashRedirect("/portfolio", "error", "This account has no holding ledger.");

  const holding = String(formData.get("holding") ?? "");
  const [projectId, vintageRaw] = holding.split(":");
  const start = String(formData.get("serialStart") ?? "").trim();
  const end = String(formData.get("serialEnd") ?? "").trim();
  const slice =
    start || end
      ? { serialStart: Number(start), serialEnd: Number(end) }
      : { quantity: Number(String(formData.get("quantity") ?? "").trim()) };

  try {
    const result = await retireCredits({
      fromAccountId: account!.id,
      projectId,
      vintageYear: Number(vintageRaw),
      beneficiary: String(formData.get("beneficiary") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      actorId: user.id,
      ...slice,
    });
    flashRedirect(
      "/portfolio",
      "notice",
      `Retired ${result.quantity} tonnes. The certificate is ready to download.`,
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/portfolio", "error", errorMessage(error, "The retirement could not be posted."));
  }
}
