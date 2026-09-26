import { prisma } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/errors";

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
]);

export async function saveDocuments(formData: FormData, projectId: string, actorId: string) {
  const files = formData
    .getAll("documents")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 5) {
    throw new LedgerError("Upload up to 5 documents at a time.", "INVALID");
  }
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) {
      throw new LedgerError("Each document must be 8 MB or smaller.", "INVALID");
    }
    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED.has(mimeType)) {
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
