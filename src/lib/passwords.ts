import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/errors";
import { LIMITS } from "@/lib/limits";

export const BCRYPT_COST = 12;

// Cost-12 hash of a string that is not a password. Compared when the email is unknown
// so the response time does not reveal whether the account exists.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$9nX.rYI4iaLytIRJnl2/ded7ZkJmea3adighS4Sw85aTnqHXuiEsm";

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8 || newPassword.length > LIMITS.password) {
    throw new LedgerError("Use a password of 8 to 200 characters.", "INVALID");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new LedgerError("Account not found.", "NOT_FOUND");
  const matches = await compare(currentPassword, user.passwordHash);
  if (!matches) throw new LedgerError("The current password is incorrect.", "INVALID");
  if (currentPassword === newPassword) {
    throw new LedgerError("Choose a different password.", "INVALID");
  }
  const passwordHash = await hash(newPassword, BCRYPT_COST);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "auth.password_changed",
      entityType: "User",
      entityId: userId,
      detail: {},
    },
  });
}
