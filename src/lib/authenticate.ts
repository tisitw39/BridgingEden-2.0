import { createHash } from "node:crypto";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { DUMMY_PASSWORD_HASH } from "@/lib/passwords";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const IP_BACKOFF_AFTER = 30;
const UNKNOWN_EMAIL = "unknown";

export function normaliseLoginEmail(raw: string): string {
  return raw.toLowerCase().trim().slice(0, 254);
}

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

function waitRemaining(count: number, latest: Date | undefined, now: number): number {
  if (!latest || count <= 0) return 0;
  return Math.max(0, latest.getTime() + backoffMs(count) - now);
}

function rightmostHop(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  return last.slice(0, 64);
}

export function clientIp(
  request: { headers: { get(name: string): string | null } },
  env: { VERCEL?: string } = { VERCEL: process.env.VERCEL },
): string {
  if (env.VERCEL) {
    const vercel = rightmostHop(request.headers.get("x-vercel-forwarded-for"));
    if (vercel) return vercel;
  }
  return (
    rightmostHop(request.headers.get("x-forwarded-for")) ||
    rightmostHop(request.headers.get("x-real-ip")) ||
    "unknown"
  );
}

async function attemptState(
  tx: Pick<typeof prisma, "loginAttempt">,
  where: { email?: string; ip?: string },
  since: Date,
) {
  const rows = await tx.loginAttempt.findMany({
    where: { ...where, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return { count: rows.length, latest: rows[0]?.createdAt };
}

export async function authenticate(emailRaw: string, password: string, ip: string) {
  const email = normaliseLoginEmail(emailRaw);
  const safeIp = ip.slice(0, 64) || "unknown";
  if (!email || !password || password.length > 200) return null;

  const decision = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`login-ip:${safeIp}`}, 0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`login-email:${email}`}, 0))::text`;

      const now = Date.now();
      const since = new Date(now - WINDOW_MS);
      const user = await tx.user.findUnique({ where: { email } });
      const bucket = (user ? user.email : UNKNOWN_EMAIL).slice(0, 254);
      const emailState = await attemptState(
        tx,
        user ? { email: bucket } : { email: UNKNOWN_EMAIL, ip: safeIp },
        since,
      );
      const ipState = await attemptState(tx, { ip: safeIp }, since);
      const emailWait = waitRemaining(emailState.count, emailState.latest, now);
      const ipWait =
        ipState.count >= IP_BACKOFF_AFTER
          ? waitRemaining(ipState.count - IP_BACKOFF_AFTER + 1, ipState.latest, now)
          : 0;
      if (emailWait > 0 || ipWait > 0) return { limited: true as const };
      await tx.loginAttempt.create({ data: { email: bucket, ip: safeIp } });
      return {
        limited: false as const,
        since,
        user: user
          ? {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              tokenVersion: user.tokenVersion,
              passwordHash: user.passwordHash,
            }
          : null,
      };
    },
    { timeout: 10_000, maxWait: 10_000 },
  );

  if (decision.limited) return null;

  const ok = await compare(password, decision.user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!decision.user || !ok) {
    if (decision.user) {
      await prisma.auditLog.create({
        data: {
          actorId: decision.user.id,
          action: "auth.login_failed",
          entityType: "User",
          entityId: decision.user.id,
          detail: { email: decision.user.email.slice(0, 254), ip: safeIp },
        },
      });
    } else {
      const already = await prisma.auditLog.findFirst({
        where: {
          action: "auth.login_failed_unknown",
          entityId: safeIp,
          createdAt: { gte: decision.since },
        },
      });
      if (!already) {
        await prisma.auditLog.create({
          data: {
            action: "auth.login_failed_unknown",
            entityType: "User",
            entityId: safeIp,
            detail: { ip: safeIp, emailSha256: createHash("sha256").update(email).digest("hex") },
          },
        });
      }
    }
    return null;
  }

  await prisma.loginAttempt.deleteMany({ where: { email: decision.user.email } });
  await prisma.auditLog.create({
    data: {
      actorId: decision.user.id,
      action: "auth.login",
      entityType: "User",
      entityId: decision.user.id,
      detail: { email: decision.user.email.slice(0, 254), ip: safeIp },
    },
  });
  return {
    id: decision.user.id,
    email: decision.user.email,
    name: decision.user.name,
    role: decision.user.role,
    tokenVersion: decision.user.tokenVersion,
  };
}
