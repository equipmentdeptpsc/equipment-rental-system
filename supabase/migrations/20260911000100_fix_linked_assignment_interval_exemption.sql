BEGIN;
SET LOCAL search_path = erp, auth, extensions, pg_catalog;

-- A Rental line may represent its source Assignment only when it carries the
-- same commitment interval.  An Assignment selected by the Rental command is
-- not otherwise safe to exclude: it can still be a standalone blocker.
CREATE OR REPLACE FUNCTION erp._equipment_commitment_rows()
RETURNS TABLE (
  source_type text,
  company_id text,
  equipment_id text,
  rental_equipment_line_id text,
  rental_id text,
  assignment_id text,
  customer_id text,
  project_id text,
  rental_number text,
  commitment_status text,
  commitment_start date,
  commitment_end date,
  is_open_ended boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
  SELECT
    'RENTAL'::text, line.company_id, line.equipment_id, line.id, rental.id,
    line.assignment_id, rental.customer_id, rental.project_id, rental.rental_number,
    rental.status::text, rental.date_out,
    COALESCE(line.actual_return_date, rental.expected_return),
    COALESCE(line.actual_return_date, rental.expected_return) IS NULL
  FROM erp.rental_equipment_lines AS line
  JOIN erp.rentals AS rental
    ON rental.id = line.rental_id
   AND rental.company_id = line.company_id
  WHERE line.deleted_at IS NULL
    AND erp.can_read_company_row(line.company_id)
    AND line.status IN ('Draft', 'Assigned', 'Reserved', 'Released', 'Active')
    AND rental.status IN ('Draft', 'Assigned', 'Reserved', 'Released', 'Active')

  UNION ALL

  SELECT
    'ASSIGNMENT'::text, assignment.company_id, assignment.equipment_id, NULL,
    NULL, assignment.id, NULL, assignment.project_id, NULL,
    assignment.status::text, assignment.assigned_date, assignment.expected_return,
    assignment.expected_return IS NULL
  FROM erp.assignments AS assignment
  WHERE assignment.deleted_at IS NULL
    AND assignment.status = 'Active'
    AND erp.can_read_company_row(assignment.company_id)
    AND NOT EXISTS (
      SELECT 1
      FROM erp.rental_equipment_lines AS line
      JOIN erp.rentals AS rental
        ON rental.id = line.rental_id
       AND rental.company_id = line.company_id
      WHERE line.deleted_at IS NULL
        AND line.assignment_id = assignment.id
        AND line.equipment_id = assignment.equipment_id
        AND line.company_id = assignment.company_id
        AND line.status IN ('Draft', 'Assigned', 'Reserved', 'Released', 'Active')
        AND rental.status IN ('Draft', 'Assigned', 'Reserved', 'Released', 'Active')
        AND rental.date_out = assignment.assigned_date
        AND COALESCE(line.actual_return_date, rental.expected_return) IS NOT DISTINCT FROM assignment.expected_return
    );
$$;

CREATE OR REPLACE FUNCTION erp.assert_equipment_interval_available(
  p_company_id text,
  p_equipment_id text,
  p_requested_start date,
  p_requested_end date,
  p_exclude_rental_line_id text DEFAULT NULL,
  p_exclude_assignment_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
DECLARE
  v_conflict record;
BEGIN
  IF p_company_id IS NULL OR p_company_id <> erp.current_company_id()
     OR p_equipment_id IS NULL OR p_requested_start IS NULL
     OR (p_requested_end IS NOT NULL AND p_requested_end < p_requested_start) THEN
    RAISE EXCEPTION 'EQUIPMENT_INTERVAL_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id || ':' || p_equipment_id, 0));

  SELECT * INTO v_conflict
  FROM (
    SELECT 'RENTAL'::text source_type, line.id rental_line_id, NULL::text assignment_id,
      rental.rental_number reference, rental.date_out starts_on,
      coalesce(line.actual_return_date, rental.expected_return) ends_on
    FROM erp.rental_equipment_lines line
    JOIN erp.rentals rental ON rental.id=line.rental_id AND rental.company_id=line.company_id
    WHERE line.company_id=p_company_id AND line.equipment_id=p_equipment_id
      AND line.deleted_at IS NULL
      AND line.status IN ('Draft','Assigned','Reserved','Released','Active')
      AND rental.status IN ('Draft','Assigned','Reserved','Released','Active')
      AND line.id IS DISTINCT FROM p_exclude_rental_line_id
    UNION ALL
    SELECT 'ASSIGNMENT', NULL::text, assignment.id, assignment.id,
      assignment.assigned_date, assignment.expected_return
    FROM erp.assignments assignment
    WHERE assignment.company_id=p_company_id AND assignment.equipment_id=p_equipment_id
      AND assignment.deleted_at IS NULL AND assignment.status='Active'
      AND assignment.id IS DISTINCT FROM p_exclude_assignment_id
      AND NOT EXISTS (
        SELECT 1 FROM erp.rental_equipment_lines line
        JOIN erp.rentals rental ON rental.id=line.rental_id AND rental.company_id=line.company_id
        WHERE line.company_id=assignment.company_id AND line.assignment_id=assignment.id
          AND line.equipment_id=assignment.equipment_id AND line.deleted_at IS NULL
          AND line.status IN ('Draft','Assigned','Reserved','Released','Active')
          AND rental.status IN ('Draft','Assigned','Reserved','Released','Active')
          AND rental.date_out = assignment.assigned_date
          AND COALESCE(line.actual_return_date, rental.expected_return) IS NOT DISTINCT FROM assignment.expected_return
      )
  ) commitment
  WHERE commitment.starts_on <= coalesce(p_requested_end, 'infinity'::date)
    AND coalesce(commitment.ends_on, 'infinity'::date) >= p_requested_start
  ORDER BY commitment.starts_on, commitment.source_type, commitment.rental_line_id NULLS LAST, commitment.assignment_id NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'EQUIPMENT_INTERVAL_CONFLICT'
      USING ERRCODE='P0001', DETAIL=jsonb_build_object(
        'equipmentId',p_equipment_id,'sourceType',v_conflict.source_type,
        'reference',v_conflict.reference,'commitmentStart',v_conflict.starts_on,
        'commitmentEnd',v_conflict.ends_on,'requestedStart',p_requested_start,
        'requestedEnd',p_requested_end
      )::text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION erp.enforce_rental_line_commitment_interval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,pg_catalog AS $$
DECLARE
  rental erp.rentals%ROWTYPE;
  v_exclude_assignment_id text;
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.status IN ('Draft','Assigned','Reserved','Released','Active') THEN
    SELECT * INTO rental FROM erp.rentals WHERE id=NEW.rental_id AND company_id=NEW.company_id;
    IF rental.id IS NULL THEN RAISE EXCEPTION 'EQUIPMENT_INTERVAL_CONFLICT' USING ERRCODE='P0001'; END IF;

    -- Only an equal-interval, active source Assignment is the same commitment.
    -- A different Rental interval must be checked against that Assignment.
    SELECT assignment.id INTO v_exclude_assignment_id
    FROM erp.assignments assignment
    WHERE assignment.id = NEW.assignment_id
      AND assignment.company_id = NEW.company_id
      AND assignment.equipment_id = NEW.equipment_id
      AND assignment.deleted_at IS NULL
      AND assignment.status = 'Active'
      AND assignment.assigned_date = rental.date_out
      AND assignment.expected_return IS NOT DISTINCT FROM rental.expected_return;

    PERFORM erp.assert_equipment_interval_available(
      NEW.company_id, NEW.equipment_id, rental.date_out, rental.expected_return,
      NULL, v_exclude_assignment_id
    );
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION erp._equipment_commitment_rows() OWNER TO postgres;
ALTER FUNCTION erp.assert_equipment_interval_available(text,text,date,date,text,text) OWNER TO postgres;
ALTER FUNCTION erp.enforce_rental_line_commitment_interval() OWNER TO postgres;
REVOKE ALL ON FUNCTION erp._equipment_commitment_rows(), erp.assert_equipment_interval_available(text,text,date,date,text,text), erp.enforce_rental_line_commitment_interval() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
