"use server";

import { draftBatch, rejectBatch, approveBatch } from "@/lib/ledger/service";
import { errorMessage, flashRedirect, isRedirectError } from "@/lib/http";
import { formatTonnes } from "@/lib/format";
import { requireAdmin } from "@/lib/session";

function wholeNumber(value: FormDataEntryValue | null): number {
  return Number(String(value ?? "").trim());
}

export async function draftBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/admin/projects/${projectId}`;
  try {
    await draftBatch({
      projectId,
      vintageYear: wholeNumber(formData.get("vintageYear")),
      quantity: wholeNumber(formData.get("quantity")),
      methodology: String(formData.get("methodology") ?? ""),
      actorId: admin.id,
    });
    flashRedirect("/admin/issuance", "notice", "Draft saved. A second step approves the issuance.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect(back, "error", errorMessage(error, "The draft could not be saved."));
  }
}

export async function approveBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  try {
    const result = await approveBatch(batchId, admin.id);
    flashRedirect(
      "/admin/issuance",
      "notice",
      `Issued ${formatTonnes(result.quantity)} tonnes. Serials ${result.serialStart}–${result.serialEnd}.`,
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/issuance", "error", errorMessage(error, "The batch could not be approved."));
  }
}

export async function rejectBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  try {
    await rejectBatch(batchId, admin.id, String(formData.get("note") ?? ""));
    flashRedirect("/admin/issuance", "notice", "Draft rejected. Nothing was written to the ledger.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/issuance", "error", errorMessage(error, "The draft could not be rejected."));
  }
}
