BEGIN;

CREATE OR REPLACE FUNCTION erp.command_return_rental_line(command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE
  tenant text=erp.current_company_id(); rental erp.rentals%ROWTYPE; line erp.rental_equipment_lines%ROWTYPE;
  available_status text; now_at timestamptz=clock_timestamp(); idem jsonb; payload_hash text; response jsonb;
  return_business_date date;
BEGIN
  IF tenant IS NULL OR NOT erp.current_user_has_permission('rental.return') THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','Rental return is not authorized.','retryable',false,'refreshRequired',false); END IF;
  IF command->>'actualReturnDate' IS NULL OR command->>'actualReturnDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','An explicit Return business date is required.','retryable',false,'refreshRequired',false); END IF;
  BEGIN return_business_date=(command->>'actualReturnDate')::date; EXCEPTION WHEN others THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','Return business date is invalid.','retryable',false,'refreshRequired',false); END;
  SELECT r.* INTO rental FROM erp.rentals AS r WHERE r.id=command->>'rentalId' AND r.company_id=tenant FOR UPDATE;
  IF rental.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND','message','Rental was not found.','retryable',false,'refreshRequired',false); END IF;
  IF return_business_date < rental.date_out THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','Return business date cannot be before Rental start.','retryable',false,'refreshRequired',false); END IF;
  SELECT l.* INTO line FROM erp.rental_equipment_lines AS l WHERE l.id=command->>'rentalLineId' AND l.rental_id=rental.id AND l.company_id=tenant FOR UPDATE;
  IF line.id IS NULL OR line.equipment_id<>command->>'equipmentId' OR line.assignment_id IS DISTINCT FROM command->>'assignmentId' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','Rental Equipment Line does not match the canonical return target.','retryable',false,'refreshRequired',false); END IF;
  idem=erp.begin_operational_command(command,'RETURN_RENTAL_LINE','RENTAL_LINE',line.id,tenant,auth.uid()::text);
  IF idem->>'state'='INVALID' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','Return command is invalid.','retryable',false,'refreshRequired',false); END IF;
  IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH','message','Idempotency key payload mismatch.','retryable',false,'refreshRequired',false); END IF;
  IF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED'); END IF;
  payload_hash=idem->>'payloadHash';
  IF line.row_version<>coalesce((command->>'expectedVersion')::bigint,line.row_version) THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','message','Rental Equipment Line version is stale.','retryable',false,'refreshRequired',true,'currentVersion',line.row_version); END IF;
  IF line.status='Returned' THEN
    IF line.actual_return_date IS DISTINCT FROM return_business_date THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','message','Authoritative Return business date is already recorded and cannot be overwritten.','retryable',false,'refreshRequired',true,'currentVersion',line.row_version); END IF;
    response=jsonb_build_object('success',true,'disposition','ALREADY_COMPLETED','serverOccurredAt',now_at,'refresh',jsonb_build_array(rental.id,line.id,line.equipment_id,line.assignment_id),'value',jsonb_build_object('rentalId',rental.id,'rentalLineId',line.id,'status',line.status,'version',line.row_version,'actualReturnDate',line.actual_return_date));
    RETURN erp.finish_operational_command(command,'RETURN_RENTAL_LINE','RENTAL_LINE',line.id,tenant,auth.uid()::text,payload_hash,response,line.row_version);
  END IF;
  IF line.status IN ('Closed','Cancelled') THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION','message','Final Rental Equipment Lines cannot be returned.','retryable',false,'refreshRequired',false); END IF;
  IF EXISTS(SELECT 1 FROM erp.deurs AS d WHERE d.rental_equipment_line_id=line.id AND d.status IN('Draft','In Progress','Submitted','Pending Acknowledgement','Rejected')) THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION','message','Open DEUR work must be completed before Return.','retryable',false,'refreshRequired',false); END IF;
  SELECT es.id INTO available_status FROM erp.equipment_statuses AS es WHERE lower(es.code)='available' ORDER BY es.id LIMIT 1;
  IF available_status IS NULL THEN RETURN jsonb_build_object('success',false,'code','PERSISTENCE_FAILURE','message','Available Equipment status is unavailable.','retryable',false,'refreshRequired',true); END IF;
  UPDATE erp.rental_equipment_lines AS l SET status='Returned',actual_return_date=return_business_date WHERE l.id=line.id RETURNING l.* INTO line;
  UPDATE erp.equipment AS e SET status_id=available_status,project_id=NULL,operator_id=NULL WHERE e.id=line.equipment_id AND e.company_id=tenant;
  UPDATE erp.assignments AS a SET status='Completed',returned_date=return_business_date WHERE a.id=line.assignment_id AND a.company_id=tenant AND a.status='Active';
  IF NOT EXISTS(SELECT 1 FROM erp.rental_equipment_lines AS l WHERE l.rental_id=rental.id AND l.status NOT IN('Returned','Closed','Cancelled')) THEN UPDATE erp.rentals AS r SET status='Returned',returned_at=now_at WHERE r.id=rental.id; END IF;
  response=jsonb_build_object('success',true,'disposition','ACCEPTED','serverOccurredAt',now_at,'refresh',jsonb_build_array(rental.id,line.id,line.equipment_id,line.assignment_id),'value',jsonb_build_object('rentalId',rental.id,'rentalLineId',line.id,'status',line.status,'version',line.row_version,'actualReturnDate',line.actual_return_date));
  RETURN erp.finish_operational_command(command,'RETURN_RENTAL_LINE','RENTAL_LINE',line.id,tenant,auth.uid()::text,payload_hash,response,line.row_version);
END $$;

CREATE OR REPLACE FUNCTION erp.command_return_all_rental_lines(command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE tenant text=erp.current_company_id(); target erp.rentals; line erp.rental_equipment_lines; outcomes jsonb='[]'::jsonb; result jsonb; readiness jsonb; idem jsonb; payload_hash text; response jsonb;
BEGIN
  IF tenant IS NULL OR NOT erp.current_user_has_permission('rental.return') THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','Rental return is not authorized.','retryable',false,'refreshRequired',false); END IF;
  IF command->>'actualReturnDate' IS NULL OR command->>'actualReturnDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','An explicit Return business date is required.','retryable',false,'refreshRequired',false); END IF;
  SELECT * INTO target FROM erp.rentals WHERE id=command->>'rentalId' AND company_id=tenant FOR UPDATE;
  IF target.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND','message','Rental was not found.','retryable',false,'refreshRequired',false); END IF;
  PERFORM 1 FROM erp.rental_equipment_lines WHERE rental_id=target.id AND company_id=tenant FOR UPDATE;
  idem=erp.begin_operational_command(command,'RETURN_ALL_RENTAL_LINES','RENTAL',target.id,tenant,auth.uid()::text);
  IF idem->>'state'='INVALID' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','message','Return command is invalid.','retryable',false,'refreshRequired',false); END IF;
  IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH','message','Idempotency key payload mismatch.','retryable',false,'refreshRequired',false); END IF;
  IF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED'); END IF;
  payload_hash=idem->>'payloadHash';
  IF target.row_version<>coalesce((command->>'expectedVersion')::bigint,target.row_version) THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','message','Rental version is stale.','retryable',false,'refreshRequired',true,'currentVersion',target.row_version); END IF;
  IF target.status<>'Active' THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION','message','Only an Active Rental can be returned.','retryable',false,'refreshRequired',false); END IF;
  readiness=erp.get_rental_return_readiness(jsonb_build_object('rentalId',target.id));
  IF readiness->'value'->>'ready'<>'true' THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION','message','Required historical DEUR expectations must be acknowledged or waived before Return.','retryable',false,'refreshRequired',false); END IF;
  IF EXISTS(SELECT 1 FROM erp.deurs WHERE rental_id=target.id AND company_id=tenant AND status IN('Draft','In Progress','Submitted','Pending Acknowledgement','Rejected')) THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION','message','Open DEUR work must be completed before Return.','retryable',false,'refreshRequired',false); END IF;
  FOR line IN SELECT * FROM erp.rental_equipment_lines WHERE rental_id=target.id AND company_id=tenant LOOP
    IF line.status NOT IN('Returned','Closed','Cancelled') THEN
      SELECT erp.command_return_rental_line(command||jsonb_build_object('commandId',(command->>'commandId')||':'||line.id,'idempotencyKey',(command->>'idempotencyKey')||':line:'||line.id,'rentalLineId',line.id,'equipmentId',line.equipment_id,'assignmentId',line.assignment_id,'expectedVersion',line.row_version,'actualReturnDate',command->>'actualReturnDate')) INTO result;
      IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Atomic return blocked'; END IF;
    END IF;
    outcomes=outcomes||jsonb_build_array(jsonb_build_object('rentalId',line.rental_id,'rentalLineId',line.id,'status','Returned','version',line.row_version+1,'actualReturnDate',command->>'actualReturnDate'));
  END LOOP;
  response=jsonb_build_object('success',true,'disposition','ACCEPTED','serverOccurredAt',clock_timestamp(),'refresh',jsonb_build_array(target.id),'value',jsonb_build_object('rentalId',target.id,'lines',outcomes,'version',target.row_version+1));
  RETURN erp.finish_operational_command(command,'RETURN_ALL_RENTAL_LINES','RENTAL',target.id,tenant,auth.uid()::text,payload_hash,response,target.row_version+1);
END $$;

ALTER FUNCTION erp.command_return_rental_line(jsonb) OWNER TO postgres;
ALTER FUNCTION erp.command_return_all_rental_lines(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_return_rental_line(jsonb),erp.command_return_all_rental_lines(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_return_rental_line(jsonb),erp.command_return_all_rental_lines(jsonb) TO authenticated;

COMMIT;
