"use server";

import { z } from "zod";
import { draftBatch, rejectBatch, approveBatch } from "@/lib/ledger/service";
import { errorCode, flashRedirect, isRedirectError } from "@/lib/http";
import { LIMITS } from "@/lib/limits";
import { requireAdmin } from "@/lib/session";

const methodologySchema = z.string().trim().min(3).max(LIMITS.methodology);
const rejectionSchema = z.string().trim().min(3).max(LIMITS.rejectionNote);

function wholeNumber(value: FormDataEntryValue | null): number {
  return Number(String(value ?? "").trim());
}

export async function draftBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/admin/projects/${projectId}`;
  const methodology = methodologySchema.safeParse(formData.get("methodology"));
  if (!methodology.success) {
    flashRedirect(back, "error", errorCode(methodology.error, "form_invalid"));
  }
  try {
    await draftBatch({
      projectId,
      vintageYear: wholeNumber(formData.get("vintageYear")),
      quantity: wholeNumber(formData.get("quantity")),
      methodology: methodology.data,
      actorId: admin.id,
    });
    flashRedirect("/admin/issuance", "notice", "draft_saved");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect(back, "error", errorCode(error, "draft_failed"));
  }
}

export async function approveBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  try {
    await approveBatch(batchId, admin.id);
    flashRedirect("/admin/issuance", "notice", "batch_approved");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/issuance", "error", errorCode(error, "approve_failed"));
  }
}

export async function rejectBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  const note = rejectionSchema.safeParse(formData.get("note"));
  if (!note.success) {
    flashRedirect("/admin/issuance", "error", errorCode(note.error, "form_invalid"));
  }
  try {
    await rejectBatch(batchId, admin.id, note.data);
    flashRedirect("/admin/issuance", "notice", "batch_rejected");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/issuance", "error", errorCode(error, "reject_failed"));
  }
}
