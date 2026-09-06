BEGIN;

-- D1 intentionally records no historical inference. Per-line actual return
-- evidence is populated only by a later, controlled return-command change.
ALTER TABLE erp.rental_equipment_lines
  ADD COLUMN actual_return_date date NULL;

-- Internal, tenant-derived commitment projection. It is deliberately not a
-- public table/view contract: public RPCs below redact source detail according
-- to the caller's existing source permissions.
CREATE FUNCTION erp._equipment_commitment_rows()
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
    );
$$;

CREATE FUNCTION erp.check_equipment_availability(
  p_equipment_id text,
  p_window_start date,
  p_window_end date
)
RETURNS TABLE (
  equipment_id text,
  available boolean,
  conflict_count bigint,
  source_type text,
  status text,
  rental_number text,
  project_label text,
  customer_label text,
  commitment_start date,
  commitment_end date,
  is_open_ended boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
DECLARE
  v_can_rental boolean := erp.current_user_has_permission('rental.read');
  v_can_assignment boolean := erp.current_user_has_permission('assignment.read');
  v_can_project boolean := erp.current_user_has_permission('project.read');
  v_can_customer boolean := erp.current_user_has_permission('customer.read');
BEGIN
  IF NOT erp.current_user_has_permission('equipment.read') THEN
    RAISE EXCEPTION 'equipment.read permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_equipment_id IS NULL OR btrim(p_equipment_id) = '' THEN
    RAISE EXCEPTION 'equipment id is required' USING ERRCODE = '22023';
  END IF;
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start > p_window_end THEN
    RAISE EXCEPTION 'availability window start and end are required and ordered' USING ERRCODE = '22023';
  END IF;
  IF p_window_end - p_window_start > 92 THEN
    RAISE EXCEPTION 'availability window must not exceed 93 days' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM erp.equipment AS equipment
    WHERE equipment.id = p_equipment_id
      AND equipment.deleted_at IS NULL
      AND erp.can_read_company_row(equipment.company_id)
  ) THEN
    RAISE EXCEPTION 'equipment is not available to the current tenant' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH conflicts AS (
    SELECT commitment.*
    FROM erp._equipment_commitment_rows() AS commitment
    WHERE commitment.equipment_id = p_equipment_id
      AND commitment.commitment_start <= p_window_end
      AND (commitment.commitment_end IS NULL OR commitment.commitment_end >= p_window_start)
  ), counted AS (
    SELECT conflicts.*, count(*) OVER () AS all_conflicts
    FROM conflicts
  ), bounded AS (
    SELECT * FROM counted
    ORDER BY commitment_start ASC, equipment_id ASC, source_type ASC,
      rental_equipment_line_id ASC NULLS LAST, assignment_id ASC NULLS LAST
    LIMIT 100
  )
  SELECT p_equipment_id, false, bounded.all_conflicts,
    CASE WHEN (bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN bounded.source_type ELSE 'RESTRICTED' END,
    CASE WHEN (bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN bounded.commitment_status END,
    CASE WHEN bounded.source_type = 'RENTAL' AND v_can_rental THEN bounded.rental_number END,
    CASE WHEN v_can_project AND ((bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)) THEN project.name END,
    CASE WHEN bounded.source_type = 'RENTAL' AND v_can_rental AND v_can_customer THEN customer.name END,
    CASE WHEN (bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN bounded.commitment_start END,
    CASE WHEN (bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN bounded.commitment_end END,
    CASE WHEN (bounded.source_type = 'RENTAL' AND v_can_rental)
              OR (bounded.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN bounded.is_open_ended END
  FROM bounded
  LEFT JOIN erp.projects AS project ON project.id = bounded.project_id
    AND project.company_id = bounded.company_id AND project.deleted_at IS NULL
  LEFT JOIN erp.customers AS customer ON customer.id = bounded.customer_id
    AND customer.company_id = bounded.company_id AND customer.deleted_at IS NULL

  UNION ALL

  SELECT p_equipment_id, true, 0::bigint, NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::date, NULL::date, NULL::boolean
  WHERE NOT EXISTS (SELECT 1 FROM conflicts);
END;
$$;

CREATE FUNCTION erp.search_equipment_commitment_conflicts(
  p_window_start date,
  p_window_end date,
  p_equipment_id text DEFAULT NULL,
  p_project_id text DEFAULT NULL,
  p_customer_id text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  equipment_id text,
  equipment_asset_number text,
  equipment_name text,
  source_type text,
  status text,
  rental_number text,
  project_label text,
  customer_label text,
  commitment_start date,
  commitment_end date,
  is_open_ended boolean,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
DECLARE
  v_limit integer := LEAST(100, GREATEST(1, COALESCE(p_limit, 25)));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_can_rental boolean := erp.current_user_has_permission('rental.read');
  v_can_assignment boolean := erp.current_user_has_permission('assignment.read');
  v_can_project boolean := erp.current_user_has_permission('project.read');
  v_can_customer boolean := erp.current_user_has_permission('customer.read');
BEGIN
  IF NOT erp.current_user_has_permission('equipment.read') THEN
    RAISE EXCEPTION 'equipment.read permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start > p_window_end THEN
    RAISE EXCEPTION 'availability window start and end are required and ordered' USING ERRCODE = '22023';
  END IF;
  IF p_window_end - p_window_start > 92 THEN
    RAISE EXCEPTION 'availability window must not exceed 93 days' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL AND NOT v_can_project THEN
    RAISE EXCEPTION 'project.read permission is required to filter by project' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NOT NULL AND NOT v_can_customer THEN
    RAISE EXCEPTION 'customer.read permission is required to filter by customer' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH commitments AS (
    SELECT commitment.*
    FROM erp._equipment_commitment_rows() AS commitment
    WHERE commitment.commitment_start <= p_window_end
      AND (commitment.commitment_end IS NULL OR commitment.commitment_end >= p_window_start)
      AND (p_equipment_id IS NULL OR commitment.equipment_id = p_equipment_id)
      AND (p_project_id IS NULL OR commitment.project_id = p_project_id)
      AND (p_customer_id IS NULL OR commitment.customer_id = p_customer_id)
  ), counted AS (
    SELECT commitments.*, count(*) OVER () AS all_commitments FROM commitments
  ), paged AS (
    SELECT * FROM counted
    ORDER BY commitment_start ASC, equipment_id ASC, source_type ASC,
      rental_equipment_line_id ASC NULLS LAST, assignment_id ASC NULLS LAST
    OFFSET v_offset LIMIT v_limit
  )
  SELECT paged.equipment_id, equipment.asset_no, equipment.equipment_name,
    CASE WHEN (paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN paged.source_type ELSE 'RESTRICTED' END,
    CASE WHEN (paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN paged.commitment_status END,
    CASE WHEN paged.source_type = 'RENTAL' AND v_can_rental THEN paged.rental_number END,
    CASE WHEN v_can_project AND ((paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)) THEN project.name END,
    CASE WHEN paged.source_type = 'RENTAL' AND v_can_rental AND v_can_customer THEN customer.name END,
    CASE WHEN (paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN paged.commitment_start END,
    CASE WHEN (paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN paged.commitment_end END,
    CASE WHEN (paged.source_type = 'RENTAL' AND v_can_rental)
              OR (paged.source_type = 'ASSIGNMENT' AND v_can_assignment)
         THEN paged.is_open_ended END,
    paged.all_commitments
  FROM paged
  JOIN erp.equipment AS equipment ON equipment.id = paged.equipment_id
    AND equipment.company_id = paged.company_id AND equipment.deleted_at IS NULL
  LEFT JOIN erp.projects AS project ON project.id = paged.project_id
    AND project.company_id = paged.company_id AND project.deleted_at IS NULL
  LEFT JOIN erp.customers AS customer ON customer.id = paged.customer_id
    AND customer.company_id = paged.company_id AND customer.deleted_at IS NULL;
END;
$$;

ALTER FUNCTION erp._equipment_commitment_rows() OWNER TO postgres;
ALTER FUNCTION erp.check_equipment_availability(text, date, date) OWNER TO postgres;
ALTER FUNCTION erp.search_equipment_commitment_conflicts(date, date, text, text, text, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION erp._equipment_commitment_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp.check_equipment_availability(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION erp.search_equipment_commitment_conflicts(date, date, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION erp.check_equipment_availability(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION erp.search_equipment_commitment_conflicts(date, date, text, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION erp.check_equipment_availability(text, date, date) IS
  'Read-only, tenant-derived inclusive availability check. Existing open-ended Rental Lines and active standalone Assignments conflict with later requested windows. Restricted source details are redacted.';
COMMENT ON FUNCTION erp.search_equipment_commitment_conflicts(date, date, text, text, text, integer, integer) IS
  'Read-only, tenant-derived, bounded canonical commitment search for rows overlapping an inclusive request window; this returns commitments, not pairwise conflict generation.';

COMMIT;
