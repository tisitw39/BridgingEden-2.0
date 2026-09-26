import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildRetirementCertificate } from "@/lib/certificate";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Sign in required", { status: 401 });
  const { eventId } = await context.params;
  const event = await prisma.ledgerEvent.findUnique({
    where: { id: eventId },
    include: { postings: { include: { account: { select: { userId: true } } } } },
  });
  if (!event || event.type !== "RETIREMENT") return new NextResponse("Not found", { status: 404 });
  const ownsIt = event.postings.some(
    (posting) => posting.side === "CREDIT" && posting.account.userId === session.user.id,
  );
  if (session.user.role !== "ADMIN" && !ownsIt) {
    return new NextResponse("Not found", { status: 404 });
  }
  const pdf = await buildRetirementCertificate(eventId);
  if (!pdf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bridging-eden-retirement-${eventId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
