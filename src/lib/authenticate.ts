import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { DUMMY_PASSWORD_HASH } from "@/lib/passwords";

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 8;
const IP_LIMIT = 100;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

async function locked(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [emailFailures, ipFailures] = await Promise.all([
    prisma.loginAttempt.count({ where: { email, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
  ]);
  return emailFailures >= EMAIL_LIMIT || ipFailures >= IP_LIMIT;
}

async function recordFailure(email: string, ip: string, actorId: string | null) {
  await prisma.loginAttempt.create({ data: { email, ip } });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "auth.login_failed",
      entityType: "User",
      entityId: actorId ?? "unknown",
      detail: { email, ip },
    },
  });
}

export async function authenticate(emailRaw: string, password: string, ip: string) {
  const email = emailRaw.toLowerCase().trim();
  if (!email || !password || password.length > 200) return null;

  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  const limited = await locked(email, ip);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (limited || !user || !ok) {
    if (!limited) await recordFailure(email, ip.slice(0, 64), user?.id ?? null);
    return null;
  }

  await prisma.loginAttempt.deleteMany({ where: { email } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      detail: { email: user.email, ip: ip.slice(0, 64) },
    },
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
