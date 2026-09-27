-- Runtime role, append-only truncate guards, and immutable account identity.
-- Migrations run as bridgingeden_owner. The application connects as bridgingeden_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridgingeden_app') THEN
    RAISE EXCEPTION 'Create the bridgingeden_app login role before migrating. The application must not connect as a superuser.';
  END IF;
END $$;

CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

ALTER TABLE "ledger_events"
  ADD CONSTRAINT "ledger_events_text_lengths"
  CHECK (
    ("memo" IS NULL OR char_length("memo") <= 500)
    AND ("beneficiary" IS NULL OR char_length("beneficiary") <= 200)
    AND ("reason" IS NULL OR char_length("reason") <= 2000)
  );

ALTER TABLE "credit_batches"
  ADD CONSTRAINT "credit_batches_text_lengths"
  CHECK (
    char_length("methodology") <= 200
    AND ("rejection_note" IS NULL OR char_length("rejection_note") <= 2000)
  );

CREATE OR REPLACE FUNCTION reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: TRUNCATE on % is not allowed', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER ledger_events_no_truncate
BEFORE TRUNCATE ON ledger_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate();

CREATE TRIGGER ledger_postings_no_truncate
BEFORE TRUNCATE ON ledger_postings
FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate();

CREATE TRIGGER issued_serial_ranges_no_truncate
BEFORE TRUNCATE ON issued_serial_ranges
FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate();

CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate();

CREATE OR REPLACE FUNCTION accounts_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'accounts.kind and accounts.code are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_kind_and_code_immutable
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION accounts_identity_immutable();

CREATE OR REPLACE FUNCTION users_role_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'ADMIN' AND NOT pg_has_role(current_user, 'bridgingeden_owner', 'member') THEN
      RAISE EXCEPTION 'only the owner role can create an admin';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.email IS DISTINCT FROM OLD.email THEN
    IF NOT pg_has_role(current_user, 'bridgingeden_owner', 'member') THEN
      RAISE EXCEPTION 'users.role and users.email are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_role_guard
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION users_role_guard();

-- Issued ranges are written only by this trigger, as the table owner.
CREATE OR REPLACE FUNCTION record_issued_range() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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

ALTER FUNCTION record_issued_range() OWNER TO bridgingeden_owner;

REVOKE ALL ON FUNCTION record_issued_range() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_issued_range() TO bridgingeden_app;

GRANT USAGE ON SCHEMA public TO bridgingeden_app;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bridgingeden_app', current_database());
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM bridgingeden_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM bridgingeden_app;

GRANT SELECT, INSERT ON TABLE
  projects,
  project_documents,
  credit_batches,
  ledger_events,
  ledger_postings,
  audit_logs,
  login_attempts
TO bridgingeden_app;

GRANT SELECT, INSERT ON TABLE users TO bridgingeden_app;
GRANT UPDATE (password_hash) ON TABLE users TO bridgingeden_app;

GRANT SELECT, INSERT ON TABLE accounts TO bridgingeden_app;
GRANT UPDATE (name) ON TABLE accounts TO bridgingeden_app;

GRANT SELECT ON TABLE issued_serial_ranges TO bridgingeden_app;
GRANT UPDATE ON TABLE credit_batches TO bridgingeden_app;
GRANT DELETE ON TABLE login_attempts TO bridgingeden_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bridgingeden_app;
