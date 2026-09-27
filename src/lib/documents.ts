import { prisma } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/errors";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_REQUEST } from "@/lib/limits";

export const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);

export function documentDownloadHeaders(fileName: string, mimeType: string, sizeBytes: number) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "") || "document";
  const mime = ALLOWED_DOCUMENT_TYPES.has(mimeType) ? mimeType : "application/octet-stream";
  return {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${safeName}"`,
    "Content-Length": String(sizeBytes),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}

export async function saveDocuments(formData: FormData, projectId: string, actorId: string) {
  const files = formData
    .getAll("documents")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > MAX_DOCUMENTS_PER_REQUEST) {
    throw new LedgerError("Upload up to 2 documents at a time.", "INVALID");
  }
  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new LedgerError("Each document must be 1.5 MB or smaller.", "INVALID");
    }
    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_DOCUMENT_TYPES.has(mimeType)) {
      throw new LedgerError("Upload a PDF, PNG, JPEG, WebP, or text file.", "INVALID");
    }
    const content = Buffer.from(await file.arrayBuffer());
    const document = await prisma.projectDocument.create({
      data: {
        projectId,
        fileName: file.name.slice(0, 180) || "document",
        mimeType,
        sizeBytes: content.length,
        content,
        uploadedById: actorId,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "document.uploaded",
        entityType: "ProjectDocument",
        entityId: document.id,
        detail: { projectId, fileName: document.fileName, sizeBytes: document.sizeBytes },
      },
    });
  }
}
