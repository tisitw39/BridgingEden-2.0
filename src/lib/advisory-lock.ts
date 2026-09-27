import type { Prisma } from "@prisma/client";

export async function tryAdvisoryLock(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
  `;
  return rows[0]?.locked === true;
}
