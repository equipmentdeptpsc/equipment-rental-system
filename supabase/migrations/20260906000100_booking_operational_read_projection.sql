BEGIN;

-- Extends the existing tenant-safe Booking projection without changing either
-- public List or Calendar contract. Operational modes own their lifecycle
-- predicates so clients cannot broaden either queue with a status parameter.
-- Expected Returns treats the canonical Rental and line lifecycle statuses as
-- authoritative. actual_return is set by the return lifecycle, whose Returned
-- status is already excluded; it is not an independent reconciliation filter.
CREATE FUNCTION erp._search_booking_rows_v2(
  p_status text DEFAULT NULL, p_customer_id text DEFAULT NULL, p_project_id text DEFAULT NULL,
  p_equipment_id text DEFAULT NULL, p_rental_number_search text DEFAULT NULL,
  p_order_field text DEFAULT 'createdAt', p_order_ascending boolean DEFAULT false,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 25,
  p_window_start date DEFAULT NULL, p_window_end date DEFAULT NULL,
  p_operational_queue text DEFAULT NULL
)
RETURNS TABLE (
  o_rental_id text, o_rental_number text, o_rental_status text, o_rental_equipment_line_id text,
  o_equipment_id text, o_equipment_asset_number text, o_equipment_name text, o_customer_id text,
  o_customer_name text, o_project_id text, o_project_name text, o_date_out date,
  o_expected_return date, o_actual_return date, o_created_at timestamptz, o_reserved_at timestamptz,
  o_released_at timestamptz, o_activated_at timestamptz, o_returned_at timestamptz,
  o_closed_at timestamptz, o_cancelled_at timestamptz, o_total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
DECLARE
  v_limit integer := LEAST(100, GREATEST(1, COALESCE(p_limit, 25)));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_order_field text := CASE WHEN p_order_field IN ('createdAt', 'dateOut', 'expectedReturn', 'rentalStatus') THEN p_order_field ELSE 'createdAt' END;
BEGIN
  IF NOT erp.current_user_has_permission('rental.read') THEN
    RAISE EXCEPTION 'rental.read permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_operational_queue IS NOT NULL AND p_operational_queue NOT IN ('UPCOMING_RELEASE', 'EXPECTED_RETURN') THEN
    RAISE EXCEPTION 'operational booking queue is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_window_start IS NULL) <> (p_window_end IS NULL) THEN
    RAISE EXCEPTION 'calendar window start and end are both required' USING ERRCODE = '22023';
  END IF;
  IF p_window_start IS NOT NULL AND p_window_start > p_window_end THEN
    RAISE EXCEPTION 'calendar window start must not follow end' USING ERRCODE = '22023';
  END IF;
  IF p_window_start IS NOT NULL AND p_window_end - p_window_start > 92 THEN
    RAISE EXCEPTION 'calendar window must not exceed 93 days' USING ERRCODE = '22023';
  END IF;
  IF p_operational_queue IS NOT NULL AND p_window_start IS NULL THEN
    RAISE EXCEPTION 'operational booking window is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT rental.id AS rental_id, rental.rental_number, rental.status::text AS rental_status,
      line.id AS rental_equipment_line_id, line.equipment_id,
      CASE WHEN erp.current_user_has_permission('equipment.read') THEN equipment.asset_no END AS equipment_asset_number,
      CASE WHEN erp.current_user_has_permission('equipment.read') THEN equipment.equipment_name END AS equipment_name,
      rental.customer_id,
      CASE WHEN erp.current_user_has_permission('customer.read') THEN customer.name END AS customer_name,
      rental.project_id,
      CASE WHEN erp.current_user_has_permission('project.read') THEN project.name END AS project_name,
      rental.date_out, rental.expected_return, rental.actual_return, rental.created_at,
      rental.reserved_at, rental.released_at, rental.activated_at, rental.returned_at,
      rental.closed_at, rental.cancelled_at
    FROM erp.rental_equipment_lines AS line
    JOIN erp.rentals AS rental ON rental.id = line.rental_id AND rental.company_id = line.company_id
    JOIN erp.equipment AS equipment ON equipment.id = line.equipment_id AND equipment.company_id = line.company_id AND equipment.deleted_at IS NULL
    LEFT JOIN erp.customers AS customer ON customer.id = rental.customer_id AND customer.company_id = rental.company_id AND customer.deleted_at IS NULL
    LEFT JOIN erp.projects AS project ON project.id = rental.project_id AND project.company_id = rental.company_id AND project.deleted_at IS NULL
    WHERE line.deleted_at IS NULL AND erp.can_read_company_row(rental.company_id)
      AND (p_status IS NULL OR rental.status::text = p_status)
      AND (p_customer_id IS NULL OR rental.customer_id = p_customer_id)
      AND (p_project_id IS NULL OR rental.project_id = p_project_id)
      AND (p_equipment_id IS NULL OR line.equipment_id = p_equipment_id)
      AND (p_rental_number_search IS NULL OR rental.rental_number ILIKE '%' || p_rental_number_search || '%')
      AND (
        (p_operational_queue = 'UPCOMING_RELEASE'
          AND rental.status = 'Reserved' AND line.status = 'Reserved'
          AND COALESCE(rental.legacy_payload->>'approvalStatus', '') = 'Approved'
          AND rental.date_out BETWEEN p_window_start AND p_window_end)
        OR (p_operational_queue = 'EXPECTED_RETURN'
          AND rental.status IN ('Released', 'Active') AND line.status IN ('Released', 'Active')
          AND rental.expected_return IS NOT NULL
          AND rental.expected_return BETWEEN p_window_start AND p_window_end)
        OR (p_operational_queue IS NULL AND (p_window_start IS NULL OR (rental.date_out <= p_window_end
          AND COALESCE(rental.actual_return, rental.expected_return, rental.date_out) >= p_window_start)))
      )
  ), counted AS (SELECT rows.*, count(*) OVER () AS total_count FROM rows)
  SELECT rental_id, rental_number, rental_status, rental_equipment_line_id, equipment_id,
    equipment_asset_number, equipment_name, customer_id, customer_name, project_id, project_name,
    date_out, expected_return, actual_return, created_at, reserved_at, released_at, activated_at,
    returned_at, closed_at, cancelled_at, total_count
  FROM counted
  ORDER BY
    CASE WHEN v_order_field = 'createdAt' AND p_order_ascending THEN counted.created_at END ASC NULLS LAST,
    CASE WHEN v_order_field = 'createdAt' AND NOT p_order_ascending THEN counted.created_at END DESC NULLS LAST,
    CASE WHEN v_order_field = 'dateOut' AND p_order_ascending THEN counted.date_out END ASC NULLS LAST,
    CASE WHEN v_order_field = 'dateOut' AND NOT p_order_ascending THEN counted.date_out END DESC NULLS LAST,
    CASE WHEN v_order_field = 'expectedReturn' AND p_order_ascending THEN counted.expected_return END ASC NULLS LAST,
    CASE WHEN v_order_field = 'expectedReturn' AND NOT p_order_ascending THEN counted.expected_return END DESC NULLS LAST,
    CASE WHEN v_order_field = 'rentalStatus' AND p_order_ascending THEN counted.rental_status END ASC NULLS LAST,
    CASE WHEN v_order_field = 'rentalStatus' AND NOT p_order_ascending THEN counted.rental_status END DESC NULLS LAST,
    CASE WHEN p_operational_queue IS NULL THEN counted.rental_equipment_line_id END DESC,
    CASE WHEN p_operational_queue IS NOT NULL THEN counted.rental_equipment_line_id END ASC
  OFFSET v_offset LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION erp._search_booking_rows(
  p_status text DEFAULT NULL, p_customer_id text DEFAULT NULL, p_project_id text DEFAULT NULL,
  p_equipment_id text DEFAULT NULL, p_rental_number_search text DEFAULT NULL,
  p_order_field text DEFAULT 'createdAt', p_order_ascending boolean DEFAULT false,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 25
)
RETURNS TABLE (
  o_rental_id text, o_rental_number text, o_rental_status text, o_rental_equipment_line_id text,
  o_equipment_id text, o_equipment_asset_number text, o_equipment_name text, o_customer_id text,
  o_customer_name text, o_project_id text, o_project_name text, o_date_out date,
  o_expected_return date, o_actual_return date, o_created_at timestamptz, o_reserved_at timestamptz,
  o_released_at timestamptz, o_activated_at timestamptz, o_returned_at timestamptz,
  o_closed_at timestamptz, o_cancelled_at timestamptz, o_total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = erp, auth, pg_catalog
AS $$ BEGIN
  RETURN QUERY SELECT * FROM erp._search_booking_rows_v2(p_status, p_customer_id, p_project_id, p_equipment_id, p_rental_number_search, p_order_field, p_order_ascending, p_offset, p_limit, NULL, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION erp.search_booking_calendar_rows(
  p_window_start date, p_window_end date,
  p_status text DEFAULT NULL, p_customer_id text DEFAULT NULL, p_project_id text DEFAULT NULL,
  p_equipment_id text DEFAULT NULL, p_rental_number_search text DEFAULT NULL,
  p_order_field text DEFAULT 'dateOut', p_order_ascending boolean DEFAULT true,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 25
)
RETURNS TABLE (
  rental_id text, rental_number text, rental_status text, rental_equipment_line_id text,
  equipment_id text, equipment_asset_number text, equipment_name text, customer_id text,
  customer_name text, project_id text, project_name text, date_out date, expected_return date,
  actual_return date, created_at timestamptz, reserved_at timestamptz, released_at timestamptz,
  activated_at timestamptz, returned_at timestamptz, closed_at timestamptz, cancelled_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = erp, auth, pg_catalog
AS $$ BEGIN
  RETURN QUERY SELECT * FROM erp._search_booking_rows_v2(p_status, p_customer_id, p_project_id, p_equipment_id, p_rental_number_search, p_order_field, p_order_ascending, p_offset, p_limit, p_window_start, p_window_end, NULL);
END; $$;

CREATE FUNCTION erp.search_upcoming_release_rows(
  p_window_start date, p_window_end date, p_customer_id text DEFAULT NULL, p_project_id text DEFAULT NULL,
  p_equipment_id text DEFAULT NULL, p_rental_number_search text DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 25
)
RETURNS TABLE (
  rental_id text, rental_number text, rental_status text, rental_equipment_line_id text,
  equipment_id text, equipment_asset_number text, equipment_name text, customer_id text,
  customer_name text, project_id text, project_name text, date_out date, expected_return date,
  actual_return date, created_at timestamptz, reserved_at timestamptz, released_at timestamptz,
  activated_at timestamptz, returned_at timestamptz, closed_at timestamptz, cancelled_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = erp, auth, pg_catalog
AS $$ BEGIN
  RETURN QUERY SELECT * FROM erp._search_booking_rows_v2(NULL, p_customer_id, p_project_id, p_equipment_id, p_rental_number_search, 'dateOut', true, p_offset, p_limit, p_window_start, p_window_end, 'UPCOMING_RELEASE');
END; $$;

CREATE FUNCTION erp.search_expected_return_rows(
  p_window_start date, p_window_end date, p_customer_id text DEFAULT NULL, p_project_id text DEFAULT NULL,
  p_equipment_id text DEFAULT NULL, p_rental_number_search text DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 25
)
RETURNS TABLE (
  rental_id text, rental_number text, rental_status text, rental_equipment_line_id text,
  equipment_id text, equipment_asset_number text, equipment_name text, customer_id text,
  customer_name text, project_id text, project_name text, date_out date, expected_return date,
  actual_return date, created_at timestamptz, reserved_at timestamptz, released_at timestamptz,
  activated_at timestamptz, returned_at timestamptz, closed_at timestamptz, cancelled_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = erp, auth, pg_catalog
AS $$ BEGIN
  RETURN QUERY SELECT * FROM erp._search_booking_rows_v2(NULL, p_customer_id, p_project_id, p_equipment_id, p_rental_number_search, 'expectedReturn', true, p_offset, p_limit, p_window_start, p_window_end, 'EXPECTED_RETURN');
END; $$;

ALTER FUNCTION erp._search_booking_rows_v2(text,text,text,text,text,text,boolean,integer,integer,date,date,text) OWNER TO postgres;
ALTER FUNCTION erp._search_booking_rows(text,text,text,text,text,text,boolean,integer,integer) OWNER TO postgres;
ALTER FUNCTION erp.search_booking_calendar_rows(date,date,text,text,text,text,text,text,boolean,integer,integer) OWNER TO postgres;
ALTER FUNCTION erp.search_upcoming_release_rows(date,date,text,text,text,text,integer,integer) OWNER TO postgres;
ALTER FUNCTION erp.search_expected_return_rows(date,date,text,text,text,text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp._search_booking_rows_v2(text,text,text,text,text,text,boolean,integer,integer,date,date,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp._search_booking_rows(text,text,text,text,text,text,boolean,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp.search_booking_calendar_rows(date,date,text,text,text,text,text,text,boolean,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION erp.search_upcoming_release_rows(date,date,text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION erp.search_expected_return_rows(date,date,text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION erp.search_booking_calendar_rows(date,date,text,text,text,text,text,text,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION erp.search_upcoming_release_rows(date,date,text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION erp.search_expected_return_rows(date,date,text,text,text,text,integer,integer) TO authenticated;

DROP FUNCTION erp._search_booking_rows_filtered(text,text,text,text,text,text,boolean,integer,integer,date,date);

COMMENT ON FUNCTION erp.search_upcoming_release_rows(date,date,text,text,text,text,integer,integer) IS
  'Read-only, tenant-derived Rental Equipment Line queue for approved Reserved Rentals with date_out in an inclusive bounded operational window.';
COMMENT ON FUNCTION erp.search_expected_return_rows(date,date,text,text,text,text,integer,integer) IS
  'Read-only, tenant-derived Rental Equipment Line queue for Released or Active Rentals with non-null expected_return in an inclusive bounded operational window.';

COMMIT;
