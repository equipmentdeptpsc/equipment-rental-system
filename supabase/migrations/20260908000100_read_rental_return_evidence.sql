BEGIN;

CREATE FUNCTION erp.read_rental_return_evidence(target_rental_id text, target_rental_equipment_line_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = erp, auth, pg_catalog
AS $$
DECLARE
  tenant text := erp.current_company_id();
  rental erp.rentals%ROWTYPE;
  line erp.rental_equipment_lines%ROWTYPE;
  assignment erp.assignments%ROWTYPE;
  return_window jsonb := NULL;
  next_window jsonb := NULL;
BEGIN
  IF tenant IS NULL THEN RETURN jsonb_build_object('success',false,'code','UNAUTHENTICATED'); END IF;
  IF NOT erp.current_user_has_permission('rental.read') OR NOT erp.current_user_has_permission('equipment.read') THEN
    RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
  END IF;
  IF nullif(btrim(target_rental_id),'') IS NULL OR nullif(btrim(target_rental_equipment_line_id),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED');
  END IF;
  SELECT * INTO rental FROM erp.rentals WHERE id=target_rental_id AND company_id=tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO line FROM erp.rental_equipment_lines WHERE id=target_rental_equipment_line_id AND rental_id=rental.id AND company_id=tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
  IF line.assignment_id IS NOT NULL THEN
    SELECT * INTO assignment FROM erp.assignments WHERE id=line.assignment_id AND company_id=tenant;
  END IF;
  IF line.actual_return_date IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) INTO return_window
      FROM erp.check_equipment_availability(line.equipment_id,line.actual_return_date,line.actual_return_date) result;
    SELECT coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) INTO next_window
      FROM erp.check_equipment_availability(line.equipment_id,line.actual_return_date + 1,line.actual_return_date + 1) result;
  END IF;
  RETURN jsonb_build_object('success',true,'rental',jsonb_build_object('id',rental.id,'number',rental.rental_number,'status',rental.status,'version',rental.row_version),
    'line',jsonb_build_object('id',line.id,'status',line.status,'actualReturnDate',line.actual_return_date,'equipmentId',line.equipment_id),
    'assignment',CASE WHEN assignment.id IS NULL THEN NULL ELSE jsonb_build_object('id',assignment.id,'status',assignment.status,'returnedDate',assignment.returned_date) END,
    'availability',jsonb_build_object('onReturnDate',return_window,'onNextDate',next_window));
END $$;

ALTER FUNCTION erp.read_rental_return_evidence(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.read_rental_return_evidence(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp.read_rental_return_evidence(text,text) TO authenticated;

COMMIT;
