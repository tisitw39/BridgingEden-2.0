import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const document = await prisma.projectDocument.findUnique({ where: { id } });
  if (!document) return new NextResponse("Not found", { status: 404 });
  const safeName = document.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new NextResponse(new Uint8Array(document.content), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(document.sizeBytes),
    },
  });
}
