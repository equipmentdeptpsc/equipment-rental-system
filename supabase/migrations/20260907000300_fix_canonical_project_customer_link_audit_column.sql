BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

-- Forward-only correction for the deployed audit_log schema. The original
-- command body used old_values, while audit_log's canonical column is
-- previous_values. Preserve every command rule and result contract.
CREATE OR REPLACE FUNCTION erp.command_update_project_customer(command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE
  tenant text=erp.current_company_id(); actor text=auth.uid()::text; now_at timestamptz=clock_timestamp();
  target_project erp.projects; target_customer erp.customers; idem jsonb; payload_hash text; response jsonb; expected bigint;
BEGIN
  IF auth.uid() IS NULL OR tenant IS NULL OR NOT EXISTS(SELECT 1 FROM erp.users u JOIN erp.companies c ON c.id=u.company_id WHERE u.id=auth.uid() AND u.status='active' AND u.company_id=tenant AND c.active) THEN RETURN jsonb_build_object('success',false,'code','UNAUTHENTICATED'); END IF;
  IF NOT erp.current_user_has_permission('project.update') THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
  IF command ?| ARRAY['companyId','company_id','tenantId','tenant_id','actor','actorId','actor_id','userId','user_id','status','active','deletedAt','deleted_at','createdBy','created_by','updatedBy','updated_by','rowVersion','row_version','location','projectCode','name']
    OR nullif(btrim(command->>'commandId'),'') IS NULL OR nullif(btrim(command->>'idempotencyKey'),'') IS NULL
    OR nullif(btrim(command->>'projectId'),'') IS NULL OR nullif(btrim(command->>'customerId'),'') IS NULL
    OR command->>'projectId'<>btrim(command->>'projectId') OR command->>'customerId'<>btrim(command->>'customerId')
    OR command->>'projectId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR command->>'customerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR nullif(command->>'expectedVersion','') IS NULL THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED'); END IF;
  BEGIN expected=(command->>'expectedVersion')::bigint; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED'); END;
  IF expected<1 THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED'); END IF;
  idem=erp.begin_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT',command->>'projectId',tenant,actor);
  IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH'); ELSIF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED'); ELSIF idem->>'state'<>'NEW' THEN RETURN jsonb_build_object('success',false,'code','VALIDATION_REJECTED'); END IF;
  payload_hash=idem->>'payloadHash';
  SELECT * INTO target_project FROM erp.projects WHERE id=command->>'projectId' AND company_id=tenant FOR UPDATE;
  IF target_project.id IS NULL OR NOT target_project.active OR target_project.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
  IF expected<>target_project.row_version THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','currentVersion',target_project.row_version); END IF;
  IF target_project.customer_id IS NOT NULL AND target_project.customer_id<>command->>'customerId' THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_RELINK_NOT_ALLOWED'); END IF;
  SELECT * INTO target_customer FROM erp.customers WHERE id=command->>'customerId' AND company_id=tenant AND active AND deleted_at IS NULL;
  IF target_customer.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_INVALID'); END IF;
  IF target_project.customer_id=target_customer.id THEN
    response=jsonb_build_object('success',true,'disposition','ACCEPTED','serverOccurredAt',now_at,'refresh',jsonb_build_array(target_project.id),'value',jsonb_build_object('id',target_project.id,'companyId',target_project.company_id,'customerId',target_project.customer_id,'rowVersion',target_project.row_version));
    RETURN erp.finish_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT',target_project.id,tenant,actor,payload_hash,response,target_project.row_version);
  END IF;
  UPDATE erp.projects SET customer_id=target_customer.id,updated_by=actor,updated_at=now_at,row_version=row_version+1 WHERE id=target_project.id AND company_id=tenant RETURNING * INTO target_project;
  INSERT INTO erp.audit_log(id,company_id,aggregate_type,aggregate_id,action,actor_id,occurred_at,correlation_id,previous_values,new_values) VALUES(gen_random_uuid()::text,tenant,'Project',target_project.id,'PROJECT_CUSTOMER_LINKED',actor,now_at,command->>'commandId',jsonb_build_object('customerId',NULL),jsonb_build_object('customerId',target_project.customer_id,'rowVersion',target_project.row_version));
  response=jsonb_build_object('success',true,'disposition','ACCEPTED','serverOccurredAt',now_at,'refresh',jsonb_build_array(target_project.id),'value',jsonb_build_object('id',target_project.id,'companyId',target_project.company_id,'customerId',target_project.customer_id,'rowVersion',target_project.row_version));
  RETURN erp.finish_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT',target_project.id,tenant,actor,payload_hash,response,target_project.row_version);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','PERSISTENCE_FAILURE'); END $$;

ALTER FUNCTION erp.command_update_project_customer(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_update_project_customer(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_update_project_customer(jsonb) TO authenticated;
COMMIT;
