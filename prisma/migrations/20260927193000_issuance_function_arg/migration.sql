-- The first version of this function took an argument named event_id, which
-- PostgreSQL treats as ambiguous next to ledger_postings.event_id.
DROP FUNCTION assert_event_issuance(text);
CREATE FUNCTION assert_event_issuance(target_event text) RETURNS void
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
  FROM ledger_events
  WHERE id = target_event;

  IF ev_type IS NULL OR ev_type <> 'ISSUANCE' OR ev_batch IS NULL THEN
    RAISE EXCEPTION 'issuance requires an approved credit batch';
  END IF;

  SELECT status, quantity, serial_start, serial_end, project_id, vintage_year
    INTO batch_status, batch_qty, batch_start, batch_end, batch_project, batch_vintage
  FROM credit_batches
  WHERE id = ev_batch;

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
  WHERE p.event_id = target_event
    AND p.side = 'CREDIT'
    AND a.kind = 'CONTRA';

  IF contra_qty <> batch_qty
     OR contra_ranges <> int8multirange(int8range(batch_start, batch_end, '[]')) THEN
    RAISE EXCEPTION 'issuance postings do not match the approved batch';
  END IF;
END;
$$;
