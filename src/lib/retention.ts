import { prisma } from "@/lib/db";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepExpiredAttempts(now = Date.now()) {
  const cutoff = new Date(now - MAX_AGE_MS);
  const [logins, lookups] = await Promise.all([
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.verifyLookup.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return { logins: logins.count, lookups: lookups.count };
}
