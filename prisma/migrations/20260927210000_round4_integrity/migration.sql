-- Drafter must be an admin, verification rows cannot be truncated, and
-- pgcrypto is unused so it does not stay installed.

DROP EXTENSION IF EXISTS pgcrypto;

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
  batch_drafted_by text;
  approver_role "Role";
  drafter_role "Role";
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

  SELECT status, quantity, serial_start, serial_end, project_id, vintage_year, approved_by_id, drafted_by_id
    INTO batch_status, batch_qty, batch_start, batch_end, batch_project, batch_vintage, batch_approved_by, batch_drafted_by
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

  -- FOR SHARE keeps the role check stable if the row is updated later in this transaction.
  SELECT role INTO approver_role FROM users WHERE id = batch_approved_by FOR SHARE;
  IF approver_role IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'the batch approver must be an admin';
  END IF;

  SELECT role INTO drafter_role FROM users WHERE id = batch_drafted_by FOR SHARE;
  IF drafter_role IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'the batch drafter must be an admin';
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

CREATE TRIGGER retirement_verifications_no_truncate
BEFORE TRUNCATE ON retirement_verifications
FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate();
