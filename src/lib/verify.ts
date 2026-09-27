import { prisma } from "@/lib/db";
import { tryAdvisoryLock } from "@/lib/advisory-lock";
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
  verification: { token: string } | null;
  project: { name: string; code: string };
  postings: { side: string; serialStart: number; serialEnd: number; quantity: number }[];
};

export function verificationUrl(token: string): string {
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/verify/${encodeURIComponent(token)}`;
}

function toRecord(event: EventWithProject): RetirementVerification | null {
  if (event.type !== "RETIREMENT" || !event.verification) return null;
  const ranges = event.postings.filter((posting) => posting.side === "CREDIT");
  return {
    eventId: event.id,
    verificationToken: event.verification.token,
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
  verification: true,
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
  const row = await prisma.retirementVerification.findUnique({
    where: { token },
    include: { event: { include: eventInclude } },
  });
  if (!row?.event) return null;
  return toRecord(row.event);
}

export type VerificationGate = "ok" | "limited" | "busy";

export async function allowVerificationLookup(ip: string): Promise<VerificationGate> {
  const safeIp = ip.slice(0, 64) || "unknown";
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `verify:${safeIp}`);
    if (!locked) return "busy";
    const since = new Date(Date.now() - VERIFY_WINDOW_MS);
    const count = await tx.verifyLookup.count({ where: { ip: safeIp, createdAt: { gte: since } } });
    if (count >= VERIFY_LIMIT) return "limited";
    await tx.verifyLookup.create({ data: { ip: safeIp } });
    return "ok";
  });
}
