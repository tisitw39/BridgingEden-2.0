-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HOLDER');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('ASSET', 'CONTRA', 'SINK');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('ISSUANCE', 'TRANSFER', 'RETIREMENT', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "PostingSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "standard_reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_batches" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "vintage_year" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "methodology" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "serial_start" INTEGER,
    "serial_end" INTEGER,
    "drafted_by_id" TEXT NOT NULL,
    "drafted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_note" TEXT,
    "seed_key" TEXT,

    CONSTRAINT "credit_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_events" (
    "id" TEXT NOT NULL,
    "type" "LedgerEventType" NOT NULL,
    "project_id" TEXT NOT NULL,
    "vintage_year" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "memo" TEXT,
    "beneficiary" TEXT,
    "reason" TEXT,
    "batch_id" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "side" "PostingSide" NOT NULL,
    "project_id" TEXT NOT NULL,
    "vintage_year" INTEGER NOT NULL,
    "serial_start" INTEGER NOT NULL,
    "serial_end" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_serial_ranges" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "vintage_year" INTEGER NOT NULL,
    "serial_start" INTEGER NOT NULL,
    "serial_end" INTEGER NOT NULL,
    "posting_id" TEXT NOT NULL,

    CONSTRAINT "issued_serial_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_key" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "project_documents_project_id_idx" ON "project_documents"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_batches_seed_key_key" ON "credit_batches"("seed_key");

-- CreateIndex
CREATE INDEX "credit_batches_project_id_status_idx" ON "credit_batches"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_events_batch_id_key" ON "ledger_events"("batch_id");

-- CreateIndex
CREATE INDEX "ledger_events_type_recorded_at_idx" ON "ledger_events"("type", "recorded_at");

-- CreateIndex
CREATE INDEX "ledger_events_project_id_vintage_year_idx" ON "ledger_events"("project_id", "vintage_year");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_postings_seq_key" ON "ledger_postings"("seq");

-- CreateIndex
CREATE INDEX "ledger_postings_account_id_project_id_vintage_year_idx" ON "ledger_postings"("account_id", "project_id", "vintage_year");

-- CreateIndex
CREATE INDEX "ledger_postings_project_id_vintage_year_idx" ON "ledger_postings"("project_id", "vintage_year");

-- CreateIndex
CREATE UNIQUE INDEX "issued_serial_ranges_posting_id_key" ON "issued_serial_ranges"("posting_id");

-- CreateIndex
CREATE INDEX "issued_serial_ranges_project_id_idx" ON "issued_serial_ranges"("project_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_drafted_by_id_fkey" FOREIGN KEY ("drafted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "credit_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ledger_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ledger invariants.
-- Balances are derived from ledger_postings. This migration refuses overlapping
-- issuances, credits that are not held, unbalanced events, and any update or
-- delete of the journal.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_serial_shape"
  CHECK (
    "serial_start" >= 1
    AND "serial_end" >= "serial_start"
    AND "serial_end" <= 1000000000
    AND "quantity" = ("serial_end" - "serial_start" + 1)
    AND "vintage_year" BETWEEN 1990 AND 2100
  );

ALTER TABLE "issued_serial_ranges"
  ADD CONSTRAINT "issued_serials_shape"
  CHECK (
    "serial_start" >= 1
    AND "serial_end" >= "serial_start"
    AND "serial_end" <= 1000000000
    AND "vintage_year" BETWEEN 1990 AND 2100
  );

-- One issued serial, per project, for the life of the ledger.
ALTER TABLE "issued_serial_ranges"
  ADD CONSTRAINT "issued_serials_do_not_overlap"
  EXCLUDE USING gist (
    "project_id" WITH =,
    int8range("serial_start", "serial_end", '[]') WITH &&
  );

ALTER TABLE "issued_serial_ranges"
  ADD CONSTRAINT "issued_serial_ranges_posting_fk"
  FOREIGN KEY ("posting_id") REFERENCES "ledger_postings"("id");

ALTER TABLE "credit_batches"
  ADD CONSTRAINT "credit_batch_quantity_positive"
  CHECK ("quantity" > 0 AND "vintage_year" BETWEEN 1990 AND 2100);

ALTER TABLE "credit_batches"
  ADD CONSTRAINT "approved_batches_have_serials"
  CHECK (
    "status" <> 'APPROVED'
    OR (
      "serial_start" IS NOT NULL
      AND "serial_end" IS NOT NULL
      AND "serial_end" >= "serial_start"
      AND ("serial_end" - "serial_start" + 1) = "quantity"
    )
  );

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER ledger_postings_append_only
BEFORE UPDATE OR DELETE ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER ledger_events_append_only
BEFORE UPDATE OR DELETE ON ledger_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER issued_serial_ranges_append_only
BEFORE UPDATE OR DELETE ON issued_serial_ranges
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE OR REPLACE FUNCTION posting_matches_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ev_project text;
  ev_vintage integer;
BEGIN
  SELECT project_id, vintage_year INTO ev_project, ev_vintage
  FROM ledger_events WHERE id = NEW.event_id;
  IF ev_project IS NULL THEN
    RAISE EXCEPTION 'ledger event % is missing', NEW.event_id;
  END IF;
  IF ev_project <> NEW.project_id OR ev_vintage <> NEW.vintage_year THEN
    RAISE EXCEPTION 'posting does not match its ledger event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_posting_matches_event
BEFORE INSERT ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION posting_matches_event();

-- A credit on an asset or sink account must already be fully held.
-- Counts are swept so a serial can return to an account after a round trip.
-- Contra credits are issuances and are checked by the overlap constraint instead.
CREATE OR REPLACE FUNCTION prevent_uncovered_credit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acct_kind "AccountKind";
  min_cov integer;
BEGIN
  IF NEW.side <> 'CREDIT' THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO acct_kind FROM accounts WHERE id = NEW.account_id;
  IF acct_kind IS NULL THEN
    RAISE EXCEPTION 'unknown account %', NEW.account_id;
  END IF;
  IF acct_kind = 'CONTRA' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.account_id || ':' || NEW.project_id || ':' || NEW.vintage_year::text, 0)
  );

  WITH points AS (
    SELECT serial_start AS pos,
           CASE WHEN side = 'DEBIT' THEN 1 ELSE -1 END AS delta
    FROM ledger_postings
    WHERE account_id = NEW.account_id
      AND project_id = NEW.project_id
      AND vintage_year = NEW.vintage_year
    UNION ALL
    SELECT serial_end + 1,
           CASE WHEN side = 'DEBIT' THEN -1 ELSE 1 END
    FROM ledger_postings
    WHERE account_id = NEW.account_id
      AND project_id = NEW.project_id
      AND vintage_year = NEW.vintage_year
  ),
  grouped AS (
    SELECT pos, SUM(delta)::integer AS delta
    FROM points
    GROUP BY pos
  ),
  running AS (
    SELECT pos, SUM(delta) OVER (ORDER BY pos ROWS UNBOUNDED PRECEDING)::integer AS qty
    FROM grouped
  )
  SELECT MIN(coverage) INTO min_cov
  FROM (
    SELECT COALESCE(
      (SELECT qty FROM running WHERE pos <= NEW.serial_start ORDER BY pos DESC LIMIT 1),
      0
    ) AS coverage
    UNION ALL
    SELECT qty FROM running WHERE pos > NEW.serial_start AND pos <= NEW.serial_end
  ) samples;

  IF min_cov IS NULL OR min_cov < 1 THEN
    RAISE EXCEPTION 'uncovered credit: account % does not hold serials %-% for project % vintage %',
      NEW.account_id, NEW.serial_start, NEW.serial_end, NEW.project_id, NEW.vintage_year;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_credit_must_be_held
BEFORE INSERT ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION prevent_uncovered_credit();

CREATE OR REPLACE FUNCTION record_issued_range() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acct_kind "AccountKind";
BEGIN
  IF NEW.side <> 'CREDIT' THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO acct_kind FROM accounts WHERE id = NEW.account_id;
  IF acct_kind IS DISTINCT FROM 'CONTRA' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('issue:' || NEW.project_id, 0));

  INSERT INTO issued_serial_ranges (id, project_id, vintage_year, serial_start, serial_end, posting_id)
  VALUES (NEW.id, NEW.project_id, NEW.vintage_year, NEW.serial_start, NEW.serial_end, NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_record_issued_range
AFTER INSERT ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION record_issued_range();

CREATE OR REPLACE FUNCTION assert_event_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_ranges int8multirange;
  credit_ranges int8multirange;
  debit_qty bigint;
  credit_qty bigint;
  debit_span bigint;
  credit_span bigint;
BEGIN
  SELECT
    COALESCE(SUM(quantity) FILTER (WHERE side = 'DEBIT'), 0),
    COALESCE(SUM(quantity) FILTER (WHERE side = 'CREDIT'), 0),
    COALESCE(range_agg(int8range(serial_start, serial_end, '[]')) FILTER (WHERE side = 'DEBIT'), int8multirange()),
    COALESCE(range_agg(int8range(serial_start, serial_end, '[]')) FILTER (WHERE side = 'CREDIT'), int8multirange())
  INTO debit_qty, credit_qty, debit_ranges, credit_ranges
  FROM ledger_postings
  WHERE event_id = NEW.event_id;

  SELECT COALESCE(SUM(upper(r) - lower(r)), 0) INTO debit_span FROM unnest(debit_ranges) AS r;
  SELECT COALESCE(SUM(upper(r) - lower(r)), 0) INTO credit_span FROM unnest(credit_ranges) AS r;

  IF debit_qty <> credit_qty
     OR debit_qty <> debit_span
     OR credit_qty <> credit_span
     OR debit_ranges <> credit_ranges THEN
    RAISE EXCEPTION 'unbalanced ledger event %', NEW.event_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_event_balanced
AFTER INSERT ON ledger_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_event_balanced();

CREATE OR REPLACE FUNCTION assert_event_has_postings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_postings WHERE event_id = NEW.id) THEN
    RAISE EXCEPTION 'ledger event % has no postings', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_event_has_postings
AFTER INSERT ON ledger_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_event_has_postings();
