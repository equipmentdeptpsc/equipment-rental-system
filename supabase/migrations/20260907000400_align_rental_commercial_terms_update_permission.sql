BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

CREATE OR REPLACE FUNCTION erp.command_update_draft_rental_terms(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE tenant text=erp.current_company_id();actor text=auth.uid()::text;target erp.rentals;line_row erp.rental_equipment_lines;item jsonb;terms jsonb;idem jsonb;payload_hash text;response jsonb;expected bigint;now_at timestamptz=clock_timestamp();
BEGIN
 IF tenant IS NULL OR NOT erp.current_user_has_permission('rental.commercialTerms.update') THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN');END IF;
 IF command ?| ARRAY['companyId','actorId','status'] OR jsonb_typeof(command->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(command->'lines')=0 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED');END IF;
 SELECT * INTO target FROM erp.rentals WHERE id=command->>'rentalId' AND company_id=tenant FOR UPDATE;
 IF target.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND');END IF;
 idem=erp.begin_operational_command(command,'UPDATE_DRAFT_RENTAL_TERMS','RENTAL',target.id,tenant,actor);IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH');ELSIF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED');END IF;payload_hash=idem->>'payloadHash';
 BEGIN expected=(command->>'expectedVersion')::bigint;EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED');END;
 IF target.status<>'Draft' THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION');ELSIF expected<>target.row_version THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','currentVersion',target.row_version);END IF;
 IF (SELECT array_agg(value->>'lineId' ORDER BY value->>'lineId') FROM jsonb_array_elements(command->'lines')) IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM erp.rental_equipment_lines WHERE rental_id=target.id AND company_id=tenant AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success',false,'code','LINE_SET_MISMATCH');END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(command->'lines') LOOP
  terms=item->'commercialTerms';SELECT * INTO line_row FROM erp.rental_equipment_lines WHERE id=item->>'lineId' AND rental_id=target.id AND company_id=tenant FOR UPDATE;
  IF jsonb_typeof(terms) IS DISTINCT FROM 'object' OR terms->>'billingMethod' NOT IN('Per Hour','Per Day','Per Week','Per Month','Per Trip','Per Kilometer','Per Cubic Meter','One Lot','Per Lot') OR length(terms->>'currency')<>3 OR jsonb_typeof(terms->'operatorIncluded') IS DISTINCT FROM 'boolean' OR nullif(terms->>'unitRate','') IS NULL OR (terms->>'unitRate')::numeric<0 OR nullif(item->>'costCodeId','') IS NULL OR nullif(item->>'activityCodeId','') IS NULL OR nullif(item->>'workDescriptionId','') IS NULL OR jsonb_typeof(item->'deurPolicy') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED');END IF;
  IF NOT EXISTS(SELECT 1 FROM erp.equipment e WHERE e.id=line_row.equipment_id AND e.company_id=tenant AND e.cost_code_id=item->>'costCodeId') OR NOT EXISTS(SELECT 1 FROM erp.assignments a WHERE a.id=line_row.assignment_id AND a.company_id=tenant AND a.activity_code_id=item->>'activityCodeId') OR NOT EXISTS(SELECT 1 FROM erp.work_descriptions w WHERE w.id=item->>'workDescriptionId' AND w.active AND w.deleted_at IS NULL) THEN RETURN jsonb_build_object('success',false,'code','MISSING_RELATIONSHIP');END IF;
 END LOOP;
 DELETE FROM erp.rental_contracts WHERE rental_id=target.id AND status='Draft';
 FOR item IN SELECT value FROM jsonb_array_elements(command->'lines') LOOP terms=item->'commercialTerms';SELECT * INTO line_row FROM erp.rental_equipment_lines WHERE id=item->>'lineId';
  INSERT INTO erp.rental_contracts(id,rental_id,rental_equipment_line_id,contract_no,customer_id,equipment_id,project_id,rental_type,billing_method,currency,unit_rate,minimum_billable_hours,overtime_rate,standby_rate,mobilization_fee,demobilization_fee,fuel_charge,operator_included,operator_rate,contract_amount,tax_rate,withholding_tax,transaction_relationship,vat_applicability,remarks,start_date,expected_end_date,status,created_by,updated_by)
  VALUES(gen_random_uuid()::text,target.id,line_row.id,'DRAFT-'||target.rental_number,target.customer_id,line_row.equipment_id,target.project_id,target.rental_type,(terms->>'billingMethod')::erp.billing_method,upper(terms->>'currency'),(terms->>'unitRate')::numeric,nullif(terms->>'minimumBillableHours','')::numeric,nullif(terms->>'overtimeRate','')::numeric,nullif(terms->>'standbyRate','')::numeric,nullif(terms->>'mobilizationFee','')::numeric,nullif(terms->>'demobilizationFee','')::numeric,nullif(terms->>'fuelCharge','')::numeric,(terms->>'operatorIncluded')::boolean,nullif(terms->>'operatorRate','')::numeric,nullif(terms->>'contractAmount','')::numeric,nullif(terms->>'taxRate','')::numeric,nullif(terms->>'withholdingTax','')::numeric,coalesce(terms->>'transactionRelationship','Non-Affiliate'),coalesce(terms->>'vatApplicability','Applicable'),terms->>'remarks',target.date_out,coalesce(target.expected_return,target.date_out),'Draft',actor,actor);
  UPDATE erp.rental_equipment_lines SET operational_metadata=operational_metadata||jsonb_build_object('draftPreparation',item-'commercialTerms'),updated_by=actor WHERE id=line_row.id;
 END LOOP;
 UPDATE erp.rentals SET approval_status='NotSubmitted',approval_requested_at=NULL,approval_requested_by=NULL,approval_decided_at=NULL,approval_decided_by=NULL,approval_decision_remarks=NULL,updated_by=actor WHERE id=target.id RETURNING * INTO target;
 INSERT INTO erp.audit_log(id,company_id,aggregate_type,aggregate_id,action,actor_id,occurred_at,correlation_id,new_values) VALUES(gen_random_uuid()::text,tenant,'Rental',target.id,'RENTAL_TERMS_UPDATED',actor,now_at,command->>'commandId',jsonb_build_object('lineCount',jsonb_array_length(command->'lines'),'version',target.row_version));
 response=jsonb_build_object('success',true,'disposition','ACCEPTED','value',jsonb_build_object('rentalId',target.id,'status',target.status,'approvalStatus',target.approval_status,'version',target.row_version));RETURN erp.finish_operational_command(command,'UPDATE_DRAFT_RENTAL_TERMS','RENTAL',target.id,tenant,actor,payload_hash,response,target.row_version);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','PERSISTENCE_FAILURE');END $$;

ALTER FUNCTION erp.command_update_draft_rental_terms(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_update_draft_rental_terms(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_update_draft_rental_terms(jsonb) TO authenticated;

COMMIT;
