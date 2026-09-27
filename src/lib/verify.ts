import { prisma } from "@/lib/db";
import { formatSerialRange } from "@/lib/format";

const TOKEN = /^[a-f0-9]{32}$/;
const VERIFY_WINDOW_MS = 10 * 60 * 1000;
const VERIFY_LIMIT = 30;

export type RetirementVerification = {
  eventId: string;
  verificationToken: string;
  projectName: string;
  projectCode: string;
  vintageYear: number;
  serials: string[];
  quantity: number;
  beneficiary: string;
  date: Date;
  status: "Retired";
};

type EventWithProject = {
  id: string;
  type: string;
  vintageYear: number;
  beneficiary: string | null;
  recordedAt: Date;
  verificationToken: string | null;
  project: { name: string; code: string };
  postings: { side: string; serialStart: number; serialEnd: number; quantity: number }[];
};

export function verificationUrl(token: string): string {
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/verify/${encodeURIComponent(token)}`;
}

function toRecord(event: EventWithProject): RetirementVerification | null {
  if (event.type !== "RETIREMENT" || !event.verificationToken) return null;
  const ranges = event.postings.filter((posting) => posting.side === "CREDIT");
  return {
    eventId: event.id,
    verificationToken: event.verificationToken,
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

const eventInclude = {
  project: true,
  postings: { orderBy: { seq: "asc" as const } },
};

export async function loadRetirementVerification(eventId: string): Promise<RetirementVerification | null> {
  if (!eventId || eventId.length > 64) return null;
  const event = await prisma.ledgerEvent.findUnique({
    where: { id: eventId },
    include: eventInclude,
  });
  if (!event) return null;
  return toRecord(event);
}

export async function loadRetirementByToken(token: string): Promise<RetirementVerification | null> {
  if (!TOKEN.test(token)) return null;
  const event = await prisma.ledgerEvent.findUnique({
    where: { verificationToken: token },
    include: eventInclude,
  });
  if (!event) return null;
  return toRecord(event);
}

export async function allowVerificationLookup(ip: string): Promise<boolean> {
  const safeIp = ip.slice(0, 64) || "unknown";
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`verify:${safeIp}`}, 0))::text`;
    const since = new Date(Date.now() - VERIFY_WINDOW_MS);
    const count = await tx.verifyLookup.count({ where: { ip: safeIp, createdAt: { gte: since } } });
    if (count >= VERIFY_LIMIT) return false;
    await tx.verifyLookup.create({ data: { ip: safeIp } });
    return true;
  });
}
