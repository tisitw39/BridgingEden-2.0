import { ownerPrisma } from "./owner-db";

const TRUNCATE_TRIGGERS = [
  ["audit_logs", "audit_logs_no_truncate"],
  ["issued_serial_ranges", "issued_serial_ranges_no_truncate"],
  ["ledger_postings", "ledger_postings_no_truncate"],
  ["ledger_events", "ledger_events_no_truncate"],
] as const;

export async function resetTransactionalData() {
  for (const [table, trigger] of TRUNCATE_TRIGGERS) {
    await ownerPrisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  }
  await ownerPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs,
      issued_serial_ranges,
      ledger_postings,
      ledger_events,
      login_attempts,
      verify_lookups,
      credit_batches,
      project_documents,
      projects
    RESTART IDENTITY CASCADE
  `);
  for (const [table, trigger] of TRUNCATE_TRIGGERS) {
    await ownerPrisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  }
}
