import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { tryAdvisoryLock } from "@/lib/advisory-lock";
import { auditEmailHmac } from "@/lib/audit-email";
import { DUMMY_PASSWORD_HASH } from "@/lib/passwords";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
export const EMAIL_WIDE_AFTER = 12;
export const IP_BACKOFF_AFTER = 30;
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

async function recordRateLimitedAudit(
  since: Date,
  user: UserSnapshot | null,
  email: string,
  ip: string,
) {
  const entityId = user?.id ?? ip;
  await prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `login-audit:${entityId}`);
    if (!locked) return;
    const already = await tx.auditLog.findFirst({
      where: { action: "auth.login_rate_limited", entityId, createdAt: { gte: since } },
    });
    if (already) return;
    await tx.auditLog.create({
      data: {
        actorId: user?.id,
        action: "auth.login_rate_limited",
        entityType: "User",
        entityId,
        detail: user
          ? { email: user.email.slice(0, 254), ip }
          : { ip, emailHmac: auditEmailHmac(email) },
      },
    });
  });
}

type UserSnapshot = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "HOLDER";
  tokenVersion: number;
  passwordHash: string;
};

export async function authenticate(emailRaw: string, password: string, ip: string) {
  const email = normaliseLoginEmail(emailRaw);
  const safeIp = ip.slice(0, 64) || "unknown";
  if (!email || !password || password.length > 200) return null;

  const decision = await prisma.$transaction(
    async (tx) => {
      const now = Date.now();
      const since = new Date(now - WINDOW_MS);
      const ipLocked = await tryAdvisoryLock(tx, `login-ip:${safeIp}`);
      const emailLocked = ipLocked && (await tryAdvisoryLock(tx, `login-email:${email}`));
      if (!ipLocked || !emailLocked) {
        return { limited: true, since, user: null as UserSnapshot | null };
      }

      const user = await tx.user.findUnique({ where: { email } });
      const bucket = (user?.email ?? UNKNOWN_EMAIL).slice(0, 254);
      const pair = await attemptState(tx, { email: bucket, ip: safeIp }, since);
      const emailWide = await attemptState(tx, { email: bucket }, since);
      const ipState = await attemptState(tx, { ip: safeIp }, since);
      const pairWait = waitRemaining(pair.count, pair.latest, now);
      const emailWideWait =
        emailWide.count >= EMAIL_WIDE_AFTER
          ? waitRemaining(emailWide.count - EMAIL_WIDE_AFTER + 1, emailWide.latest, now)
          : 0;
      const ipWait =
        ipState.count >= IP_BACKOFF_AFTER
          ? waitRemaining(ipState.count - IP_BACKOFF_AFTER + 1, ipState.latest, now)
          : 0;
      const limited = pairWait > 0 || emailWideWait > 0 || ipWait > 0;
      if (!limited) {
        await tx.loginAttempt.create({ data: { email: bucket, ip: safeIp } });
      }
      return {
        limited,
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
    { timeout: 5_000, maxWait: 2_000 },
  );

  // Always one bcrypt compare. A limited request and an unknown email take the same path.
  const matches = await compare(password, decision.user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (decision.limited) {
    await recordRateLimitedAudit(decision.since, decision.user, email, safeIp);
    return null;
  }
  if (!decision.user || !matches) {
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
            detail: { ip: safeIp, emailHmac: auditEmailHmac(email) },
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
