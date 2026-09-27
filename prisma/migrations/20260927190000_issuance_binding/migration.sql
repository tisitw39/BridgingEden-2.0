-- Bind issuance to an approved batch, freeze batches, column-level grants,
-- session token versions, and public verification tokens.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ledger_events" ADD COLUMN "verification_token" TEXT;
CREATE UNIQUE INDEX "ledger_events_verification_token_key" ON "ledger_events"("verification_token");

-- Existing retirements are append-only, so the owner disables that one trigger
-- for this backfill and turns it back on before the migration commits.
ALTER TABLE "ledger_events" DISABLE TRIGGER "ledger_events_append_only";
UPDATE "ledger_events"
SET "verification_token" = encode(gen_random_bytes(16), 'hex')
WHERE "type" = 'RETIREMENT' AND "verification_token" IS NULL;
ALTER TABLE "ledger_events" ENABLE TRIGGER "ledger_events_append_only";

ALTER TABLE "credit_batches"
  ADD CONSTRAINT "credit_batches_four_eyes"
  CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "drafted_by_id");

DELETE FROM "login_attempts" WHERE char_length("email") > 254;
ALTER TABLE "login_attempts"
  ADD CONSTRAINT "login_attempts_email_length"
  CHECK (char_length("email") <= 254);

CREATE TABLE "verify_lookups" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verify_lookups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verify_lookups_ip_created_at_idx" ON "verify_lookups"("ip", "created_at");

CREATE OR REPLACE FUNCTION credit_batches_freeze() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'credit batch % is frozen', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_batches_freeze_nondraft
BEFORE UPDATE ON credit_batches
FOR EACH ROW EXECUTE FUNCTION credit_batches_freeze();

CREATE OR REPLACE FUNCTION assert_event_issuance(event_id text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  ev_type "LedgerEventType";
  ev_batch text;
  ev_project text;
  ev_vintage integer;
  batch_status "BatchStatus";
  batch_qty integer;
  batch_start integer;
  batch_end integer;
  batch_project text;
  batch_vintage integer;
  contra_qty bigint;
  contra_ranges int8multirange;
BEGIN
  SELECT type, batch_id, project_id, vintage_year
    INTO ev_type, ev_batch, ev_project, ev_vintage
  FROM ledger_events WHERE id = event_id;

  IF ev_type IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;
  IF ev_type <> 'ISSUANCE' THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;
  IF ev_batch IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;

  SELECT status, quantity, serial_start, serial_end, project_id, vintage_year
    INTO batch_status, batch_qty, batch_start, batch_end, batch_project, batch_vintage
  FROM credit_batches WHERE id = ev_batch;

  IF batch_status IS DISTINCT FROM 'APPROVED'
     OR batch_project IS DISTINCT FROM ev_project
     OR batch_vintage IS DISTINCT FROM ev_vintage
     OR batch_start IS NULL
     OR batch_end IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;

  SELECT
    COALESCE(SUM(p.quantity), 0),
    COALESCE(range_agg(int8range(p.serial_start, p.serial_end, '[]')), int8multirange())
  INTO contra_qty, contra_ranges
  FROM ledger_postings p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.event_id = event_id
    AND p.side = 'CREDIT'
    AND a.kind = 'CONTRA';

  IF contra_qty <> batch_qty
     OR contra_ranges <> int8multirange(int8range(batch_start, batch_end, '[]')) THEN
    RAISE EXCEPTION 'issuance postings do not match the approved batch';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION assert_contra_credit_backed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  acct_kind "AccountKind";
BEGIN
  IF NEW.side IS DISTINCT FROM 'CREDIT' THEN
    RETURN NULL;
  END IF;
  SELECT kind INTO acct_kind FROM accounts WHERE id = NEW.account_id;
  IF acct_kind IS DISTINCT FROM 'CONTRA' THEN
    RETURN NULL;
  END IF;
  PERFORM assert_event_issuance(NEW.event_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION assert_issuance_event_backed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM 'ISSUANCE' THEN
    RETURN NULL;
  END IF;
  PERFORM assert_event_issuance(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER issuance_posting_requires_batch
AFTER INSERT ON ledger_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_contra_credit_backed();

CREATE CONSTRAINT TRIGGER issuance_event_requires_batch
AFTER INSERT ON ledger_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_issuance_event_backed();

REVOKE ALL ON TABLE verify_lookups FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE verify_lookups TO bridgingeden_app;

REVOKE UPDATE ON TABLE credit_batches FROM bridgingeden_app;
GRANT UPDATE (
  status,
  serial_start,
  serial_end,
  approved_by_id,
  approved_at,
  rejected_by_id,
  rejected_at,
  rejection_note
) ON TABLE credit_batches TO bridgingeden_app;

GRANT UPDATE (token_version) ON TABLE users TO bridgingeden_app;
