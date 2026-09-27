import { NextResponse } from "next/server";
import { documentDownloadHeaders } from "@/lib/documents";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const document = await prisma.projectDocument.findUnique({ where: { id } });
  if (!document) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(document.content), {
    headers: documentDownloadHeaders(document.fileName, document.mimeType, document.sizeBytes),
  });
}
