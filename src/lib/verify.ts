import { prisma } from "@/lib/db";
import { formatSerialRange } from "@/lib/format";

export type RetirementVerification = {
  eventId: string;
  projectName: string;
  projectCode: string;
  vintageYear: number;
  serials: string[];
  quantity: number;
  beneficiary: string;
  date: Date;
  status: "Retired";
};

export function verificationUrl(eventId: string): string {
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/verify/${encodeURIComponent(eventId)}`;
}

export async function loadRetirementVerification(eventId: string): Promise<RetirementVerification | null> {
  if (!eventId || eventId.length > 64) return null;
  const event = await prisma.ledgerEvent.findUnique({
    where: { id: eventId },
    include: { project: true, postings: { orderBy: { seq: "asc" } } },
  });
  if (!event || event.type !== "RETIREMENT") return null;
  const ranges = event.postings.filter((posting) => posting.side === "CREDIT");
  return {
    eventId: event.id,
    projectName: event.project.name,
    projectCode: event.project.code,
    vintageYear: event.vintageYear,
    serials: ranges.map((posting) =>
      formatSerialRange(event.project.code, event.vintageYear, posting.serialStart, posting.serialEnd),
    ),
    quantity: ranges.reduce((sum, posting) => sum + posting.quantity, 0),
    beneficiary: event.beneficiary ?? "",
    date: event.recordedAt,
    status: "Retired",
  };
}
