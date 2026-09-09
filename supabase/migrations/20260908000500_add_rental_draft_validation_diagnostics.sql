BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

-- Preserve create-draft acceptance semantics while making validation diagnostics
-- safe and actionable for authenticated canonical clients.
CREATE OR REPLACE FUNCTION erp.command_create_draft_rental(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE tenant text=erp.current_company_id();actor text=auth.uid()::text;now_at timestamptz=clock_timestamp();target_id text;number_value text;
 customer_row erp.customers;project_row erp.projects;item jsonb;requested int;valid int;idem jsonb;payload_hash text;response jsonb;line_ids jsonb='[]'::jsonb;new_line_id text;violated_constraint text;
BEGIN
 IF tenant IS NULL OR NOT EXISTS(SELECT 1 FROM erp.companies WHERE id=tenant AND active) THEN RETURN jsonb_build_object('success',false,'code','UNAUTHENTICATED');END IF;
 IF NOT erp.current_user_has_permission('rental.create') THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN');END IF;
 IF command ?| ARRAY['companyId','company_id','tenantId','tenant_id','actor','actorId','userId','status','rentalNumber']
 OR nullif(btrim(command->>'commandId'),'') IS NULL OR nullif(btrim(command->>'idempotencyKey'),'') IS NULL
 OR nullif(btrim(command->>'customerId'),'') IS NULL OR nullif(btrim(command->>'projectId'),'') IS NULL
 OR nullif(btrim(command->>'dateOut'),'') IS NULL OR command->>'rentalType' NOT IN('Bare Rental','Operated Rental')
 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_COMMAND'));END IF;
 IF length(btrim(coalesce(command->>'representativeName',''))) NOT BETWEEN 1 AND 200
 OR btrim(coalesce(command->>'representativeName','')) ~ E'[\\r\\n]'
 OR length(lower(btrim(coalesce(command->>'representativeEmail','')))) NOT BETWEEN 3 AND 254
 OR lower(btrim(coalesce(command->>'representativeEmail',''))) ~ E'[\\r\\n]'
 OR lower(btrim(coalesce(command->>'representativeEmail',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_CONTACT'));END IF;
 IF jsonb_typeof(command->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(command->'lines')=0
 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_LINE_SET'));END IF;
 BEGIN IF nullif(command->>'expectedReturn','') IS NOT NULL AND (command->>'expectedReturn')::date<(command->>'dateOut')::date THEN RAISE EXCEPTION 'dates';END IF;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_DATE'));END;
 target_id=command->>'commandId';idem=erp.begin_operational_command(command,'CREATE_DRAFT_RENTAL','RENTAL',target_id,tenant,actor);
 IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH');ELSIF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED');ELSIF idem->>'state'<>'NEW' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_IDEMPOTENCY_STATE'));END IF;payload_hash=idem->>'payloadHash';
 SELECT * INTO customer_row FROM erp.customers WHERE id=command->>'customerId' AND company_id=tenant AND active AND deleted_at IS NULL;
 SELECT * INTO project_row FROM erp.projects WHERE id=command->>'projectId' AND company_id=tenant AND customer_id=customer_row.id AND active AND deleted_at IS NULL;
 IF customer_row.id IS NULL OR project_row.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND');END IF;
 SELECT count(*),count(DISTINCT value->>'assignmentId') INTO requested,valid FROM jsonb_array_elements(command->'lines');
 IF requested<>valid OR EXISTS(SELECT 1 FROM jsonb_array_elements(command->'lines') x WHERE nullif(x.value->>'assignmentId','') IS NULL OR (x.value-'assignmentId')<>'{}'::jsonb)
 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED','details',jsonb_build_object('reason','INVALID_LINE_SHAPE'));END IF;
 PERFORM a.id FROM erp.assignments a JOIN jsonb_array_elements(command->'lines') x ON x.value->>'assignmentId'=a.id WHERE a.company_id=tenant ORDER BY a.id FOR UPDATE;
 PERFORM e.id FROM erp.equipment e JOIN erp.assignments a ON a.equipment_id=e.id JOIN jsonb_array_elements(command->'lines') x ON x.value->>'assignmentId'=a.id WHERE e.company_id=tenant ORDER BY e.id FOR UPDATE;
 SELECT count(*) INTO valid FROM jsonb_array_elements(command->'lines') x JOIN erp.assignments a ON a.id=x.value->>'assignmentId' AND a.company_id=tenant AND a.project_id=project_row.id AND a.status='Active' AND a.deleted_at IS NULL JOIN erp.equipment e ON e.id=a.equipment_id AND e.company_id=tenant AND e.active AND e.deleted_at IS NULL JOIN erp.operators o ON o.id=a.operator_id AND o.company_id=tenant AND o.status='Active' AND o.deleted_at IS NULL;
 IF valid<>requested THEN RETURN jsonb_build_object('success',false,'code','MISSING_RELATIONSHIP');END IF;
 IF EXISTS(SELECT 1 FROM erp.rentals WHERE id=target_id) THEN RETURN jsonb_build_object('success',false,'code','RENTAL_CONFLICT');END IF;
 number_value=erp.next_rental_number();
 INSERT INTO erp.rentals(id,rental_number,customer_id,project_id,customer_snapshot,project_snapshot,date_out,expected_return,rental_type,status,approval_status,customer_review_name_snapshot,customer_review_email_snapshot,customer_review_contact_captured_at,created_by,updated_by,company_id)
 VALUES(target_id,number_value,customer_row.id,project_row.id,customer_row.name,project_row.name,(command->>'dateOut')::date,nullif(command->>'expectedReturn','')::date,command->>'rentalType','Draft','NotSubmitted',btrim(command->>'representativeName'),lower(btrim(command->>'representativeEmail')),now_at,actor,actor,tenant);
 FOR item IN SELECT value FROM jsonb_array_elements(command->'lines') ORDER BY value->>'assignmentId' LOOP
  INSERT INTO erp.rental_equipment_lines(id,rental_id,equipment_id,assignment_id,operator_id,status,created_by,updated_by,company_id)
  SELECT gen_random_uuid()::text,target_id,a.equipment_id,a.id,a.operator_id,'Draft',actor,actor,tenant FROM erp.assignments a WHERE a.id=item->>'assignmentId' RETURNING id INTO new_line_id;
  line_ids=line_ids||jsonb_build_array(new_line_id);
 END LOOP;
 INSERT INTO erp.audit_log(id,company_id,aggregate_type,aggregate_id,action,actor_id,occurred_at,correlation_id,new_values) VALUES(gen_random_uuid()::text,tenant,'Rental',target_id,'RENTAL_DRAFT_CREATED',actor,now_at,command->>'commandId',jsonb_build_object('rentalNumber',number_value,'lineIds',line_ids));
 response=jsonb_build_object('success',true,'disposition','ACCEPTED','value',jsonb_build_object('rentalId',target_id,'rentalNumber',number_value,'status','Draft','approvalStatus','NotSubmitted','version',1,'lineIds',line_ids));
 RETURN erp.finish_operational_command(command,'CREATE_DRAFT_RENTAL','RENTAL',target_id,tenant,actor,payload_hash,response,1);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
 RETURN jsonb_build_object('success',false,'code','EQUIPMENT_INTERVAL_CONFLICT','message','Equipment is already committed for the selected dates.');
WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
 IF violated_constraint='uq_rental_lines_company_non_final_equipment' THEN
  RETURN jsonb_build_object('success',false,'code','EQUIPMENT_UNAVAILABLE','message','This equipment already has an active or pending Rental.');
 ELSIF violated_constraint='uq_rentals_number' THEN
  RETURN jsonb_build_object('success',false,'code','RENTAL_NUMBER_CONFLICT','message','A Rental with this number already exists for the company.');
 END IF;
 RETURN jsonb_build_object('success',false,'code','PERSISTENCE_FAILURE');
WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','PERSISTENCE_FAILURE');END $$;

ALTER FUNCTION erp.command_create_draft_rental(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_create_draft_rental(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated;
COMMENT ON FUNCTION erp.command_create_draft_rental(jsonb) IS
  'Creates a Draft Rental with tenant-derived authority, idempotency, interval enforcement, immutable Rental-specific Customer Review contact evidence, and safe validation diagnostics.';
COMMIT;
