-- Bind issuance to an approved batch, freeze batches, column-level grants,
-- session token versions, and public verification tokens.
--
-- Verification tokens live in retirement_verifications. This migration does not
-- update ledger_events. The append-only trigger on the journal stays enabled.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "retirement_verifications" (
    "event_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    CONSTRAINT "retirement_verifications_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "retirement_verifications_token_key" UNIQUE ("token"),
    CONSTRAINT "retirement_verifications_event_id_fkey"
      FOREIGN KEY ("event_id") REFERENCES "ledger_events"("id")
);

CREATE TRIGGER retirement_verifications_append_only
BEFORE UPDATE OR DELETE ON retirement_verifications
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

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

-- A new batch is a draft. Approval, rejection, and serials are filled in later,
-- in the same transaction as the issuance event.
CREATE OR REPLACE FUNCTION credit_batches_insert_draft_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'DRAFT'
     OR NEW.serial_start IS NOT NULL
     OR NEW.serial_end IS NOT NULL
     OR NEW.approved_by_id IS NOT NULL
     OR NEW.approved_at IS NOT NULL
     OR NEW.rejected_by_id IS NOT NULL
     OR NEW.rejected_at IS NOT NULL
     OR NEW.rejection_note IS NOT NULL THEN
    RAISE EXCEPTION 'a new credit batch must be an unapproved draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_batches_insert_draft_only
BEFORE INSERT ON credit_batches
FOR EACH ROW EXECUTE FUNCTION credit_batches_insert_draft_only();

-- The argument is target_event, not event_id: ledger_postings.event_id would
-- otherwise hide the argument inside this function.
CREATE OR REPLACE FUNCTION assert_event_issuance(target_event text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  ev_type "LedgerEventType";
  ev_batch text;
  ev_project text;
  ev_vintage integer;
  ev_actor text;
  batch_status "BatchStatus";
  batch_qty integer;
  batch_start integer;
  batch_end integer;
  batch_project text;
  batch_vintage integer;
  batch_approved_by text;
  approver_role "Role";
  contra_qty bigint;
  contra_ranges int8multirange;
BEGIN
  SELECT type, batch_id, project_id, vintage_year, actor_id
    INTO ev_type, ev_batch, ev_project, ev_vintage, ev_actor
  FROM ledger_events WHERE id = target_event;

  IF ev_type IS NULL OR ev_type <> 'ISSUANCE' THEN
    RAISE EXCEPTION 'a contra credit is only allowed on an issuance';
  END IF;
  IF ev_batch IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;

  SELECT status, quantity, serial_start, serial_end, project_id, vintage_year, approved_by_id
    INTO batch_status, batch_qty, batch_start, batch_end, batch_project, batch_vintage, batch_approved_by
  FROM credit_batches WHERE id = ev_batch;

  IF batch_status IS DISTINCT FROM 'APPROVED'
     OR batch_project IS DISTINCT FROM ev_project
     OR batch_vintage IS DISTINCT FROM ev_vintage
     OR batch_start IS NULL
     OR batch_end IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;

  IF ev_actor IS DISTINCT FROM batch_approved_by THEN
    RAISE EXCEPTION 'the issuance actor must be the batch approver';
  END IF;

  SELECT role INTO approver_role FROM users WHERE id = batch_approved_by;
  IF approver_role IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'the batch approver must be an admin';
  END IF;

  SELECT
    COALESCE(SUM(p.quantity), 0),
    COALESCE(range_agg(int8range(p.serial_start, p.serial_end, '[]')), int8multirange())
  INTO contra_qty, contra_ranges
  FROM ledger_postings p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.event_id = target_event
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

CREATE OR REPLACE FUNCTION assert_approved_batch_has_issuance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  issuance_event text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'APPROVED' THEN
    RETURN NULL;
  END IF;
  SELECT id INTO issuance_event
  FROM ledger_events
  WHERE batch_id = NEW.id AND type = 'ISSUANCE';
  IF issuance_event IS NULL THEN
    RAISE EXCEPTION 'an approved batch requires its issuance event';
  END IF;
  PERFORM assert_event_issuance(issuance_event);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION reject_contra_debit_off_issuance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  acct_kind "AccountKind";
  ev_type "LedgerEventType";
BEGIN
  IF NEW.side IS DISTINCT FROM 'DEBIT' THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO acct_kind FROM accounts WHERE id = NEW.account_id;
  IF acct_kind IS DISTINCT FROM 'CONTRA' THEN
    RETURN NEW;
  END IF;
  SELECT type INTO ev_type FROM ledger_events WHERE id = NEW.event_id;
  IF ev_type IS DISTINCT FROM 'ISSUANCE' THEN
    RAISE EXCEPTION 'a contra account can only be debited by an issuance';
  END IF;
  RETURN NEW;
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

CREATE CONSTRAINT TRIGGER approved_batch_requires_issuance
AFTER UPDATE ON credit_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_approved_batch_has_issuance();

CREATE TRIGGER contra_debit_requires_issuance
BEFORE INSERT ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION reject_contra_debit_off_issuance();

REVOKE ALL ON TABLE verify_lookups FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE verify_lookups TO bridgingeden_app;

REVOKE ALL ON TABLE retirement_verifications FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE retirement_verifications TO bridgingeden_app;

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
