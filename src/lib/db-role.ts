import { Prisma, type PrismaClient } from "@prisma/client";

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
          AND c.relname IN (
            'ledger_events',
            'ledger_postings',
            'issued_serial_ranges',
            'audit_logs',
            'credit_batches',
            'retirement_verifications'
          )
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

export const GUARD_TRIGGERS = [
  "accounts_kind_and_code_immutable",
  "approved_batch_requires_issuance",
  "audit_logs_append_only",
  "audit_logs_no_truncate",
  "contra_debit_requires_issuance",
  "credit_batches_freeze_nondraft",
  "credit_batches_insert_draft_only",
  "issuance_event_requires_batch",
  "issuance_posting_requires_batch",
  "issued_serial_ranges_append_only",
  "issued_serial_ranges_no_truncate",
  "ledger_credit_must_be_held",
  "ledger_event_balanced",
  "ledger_event_has_postings",
  "ledger_events_append_only",
  "ledger_events_no_truncate",
  "ledger_posting_matches_event",
  "ledger_postings_append_only",
  "ledger_postings_no_truncate",
  "ledger_record_issued_range",
  "retirement_verifications_append_only",
  "retirement_verifications_no_truncate",
  "users_role_guard",
] as const;

export async function disabledGuardTriggerProblem(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<string | null> {
  const names = Prisma.join([...GUARD_TRIGGERS]);
  const rows = await client.$queryRaw<{ tgname: string; tgenabled: string }[]>`
    SELECT t.tgname, t.tgenabled::text AS tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN (${names})
  `;
  const enabled = new Map(rows.map((row) => [row.tgname, row.tgenabled.trim()]));
  const disabled = GUARD_TRIGGERS.filter((name) => enabled.get(name) !== "O");
  if (disabled.length === 0) return null;
  return `Integrity triggers must be enabled: ${disabled.join(", ")}.`;
}
