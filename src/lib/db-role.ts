import type { PrismaClient } from "@prisma/client";

type RoleRow = {
  login: string;
  rolsuper: boolean;
  owner_member: boolean;
  owns_ledger: boolean;
};

export async function runtimeRoleProblem(client: Pick<PrismaClient, "$queryRaw">): Promise<string | null> {
  const rows = await client.$queryRaw<RoleRow[]>`
    SELECT
      r.rolname AS login,
      r.rolsuper,
      EXISTS (
        SELECT 1
        FROM pg_roles owner_role
        WHERE owner_role.rolname = 'bridgingeden_owner'
          AND pg_has_role(r.oid, owner_role.oid, 'member')
      ) AS owner_member,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('ledger_events', 'ledger_postings', 'issued_serial_ranges', 'audit_logs')
          AND c.relowner = r.oid
      ) AS owns_ledger
    FROM pg_roles r
    WHERE r.rolname = current_user
  `;
  const row = rows[0];
  if (!row) return "The application database role could not be read.";
  if (row.rolsuper) return "The application database role must not be a superuser.";
  if (row.owner_member) return "The application database role must not be a member of bridgingeden_owner.";
  if (row.owns_ledger) return "The application database role must not own ledger tables.";
  return null;
}
