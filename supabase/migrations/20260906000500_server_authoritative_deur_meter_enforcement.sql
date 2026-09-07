BEGIN;

SET LOCAL search_path=erp,auth,extensions,pg_catalog;

-- Complete Shift must derive meter applicability from the frozen canonical
-- Rental Line expectation. The command supplies evidence only; any legacy
-- client meterRequirement property is intentionally ignored.
CREATE OR REPLACE FUNCTION erp.command_complete_deur_shift(command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE
  tenant text:=erp.current_company_id();
  scope jsonb;
  idem jsonb;
  now_at timestamptz:=erp.deur_operational_clock();
  current_deur erp.deurs%ROWTYPE;
  response jsonb;
  payload_hash text;
  next_sequence integer;
  open_activity text;
  meter_requirement text;
  equipment_meter_type text;
  closing_value numeric;
BEGIN
  scope:=erp.validate_deur_custody_command_scope(command,'deur.create');
  IF scope->>'code'<>'OK' THEN RETURN jsonb_build_object('success',false,'code',scope->>'code'); END IF;
  idem:=erp.begin_deur_command(command,'COMPLETE_SHIFT');
  IF idem->>'state'='MISMATCH' THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_MISMATCH'); END IF;
  IF idem->>'state'='REPLAY' THEN RETURN (idem->'response')||jsonb_build_object('disposition','REPLAYED'); END IF;
  payload_hash:=idem->>'payloadHash';

  SELECT * INTO current_deur
  FROM erp.deurs AS deur_record
  WHERE deur_record.id=(command->>'deurId') AND deur_record.company_id=tenant
  FOR UPDATE;
  IF current_deur.id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
  IF erp.current_deur_authorized_operator(current_deur.id)<>command->>'operatorId' THEN RETURN jsonb_build_object('success',false,'code','OWNERSHIP_MISMATCH'); END IF;
  IF current_deur.row_version<>(command->>'expectedVersion')::bigint THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','aggregateId',current_deur.id,'expectedVersion',(command->>'expectedVersion')::bigint,'currentVersion',current_deur.row_version,'refreshRequired',true); END IF;
  IF current_deur.status<>'In Progress' THEN RETURN jsonb_build_object('success',false,'code','INVALID_TRANSITION'); END IF;

  SELECT line.operational_metadata#>>'{deurExpectationSnapshot,meterRequirement}',equipment.maintenance_type
  INTO meter_requirement,equipment_meter_type
  FROM erp.rental_equipment_lines AS line
  JOIN erp.equipment AS equipment ON equipment.id=line.equipment_id AND equipment.company_id=tenant
  WHERE line.id=current_deur.rental_equipment_line_id AND line.company_id=tenant;

  IF meter_requirement IS NULL OR meter_requirement NOT IN ('none','hourMeter','odometer','both') THEN
    RETURN jsonb_build_object('success',false,'code','METER_POLICY_INVALID');
  END IF;
  IF meter_requirement='both' THEN
    -- The current canonical schema has one Equipment meter capability and one
    -- DEUR opening/closing pair. Fail closed instead of inventing dual storage.
    RETURN jsonb_build_object('success',false,'code','METER_POLICY_UNSUPPORTED');
  END IF;
  IF meter_requirement='hourMeter' AND coalesce(equipment_meter_type,'')<>'Engine Hours' THEN
    RETURN jsonb_build_object('success',false,'code','METER_POLICY_INVALID');
  END IF;
  IF meter_requirement='odometer' AND coalesce(equipment_meter_type,'') NOT IN ('Kilometers','Mileage') THEN
    RETURN jsonb_build_object('success',false,'code','METER_POLICY_INVALID');
  END IF;

  IF meter_requirement='hourMeter' AND nullif(trim(command->>'closingMeter'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','CLOSING_HOUR_METER_REQUIRED');
  END IF;
  IF meter_requirement='odometer' AND nullif(trim(command->>'closingMeter'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','CLOSING_ODOMETER_REQUIRED');
  END IF;
  IF meter_requirement IN ('hourMeter','odometer') THEN
    BEGIN
      closing_value:=(command->>'closingMeter')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success',false,'code','CLOSING_METER_INVALID');
    END;
    IF closing_value::text='NaN' OR closing_value<0 THEN
      RETURN jsonb_build_object('success',false,'code','CLOSING_METER_INVALID');
    END IF;
    IF current_deur.opening_meter IS NOT NULL AND closing_value<current_deur.opening_meter THEN
      RETURN jsonb_build_object('success',false,'code','CLOSING_METER_BELOW_OPENING');
    END IF;
  END IF;

  SELECT event_record.activity_type INTO open_activity
  FROM erp.deur_events AS event_record
  WHERE event_record.deur_id=current_deur.id AND event_record.is_open AND event_record.activity_type<>'shift'
  FOR UPDATE;
  UPDATE erp.deur_events AS event_record SET is_open=false WHERE event_record.deur_id=current_deur.id AND event_record.is_open;
  SELECT coalesce(max(event_record.sequence),0)+1 INTO next_sequence FROM erp.deur_events AS event_record WHERE event_record.deur_id=current_deur.id;
  IF open_activity IS NOT NULL THEN
    INSERT INTO erp.deur_events(id,deur_id,activity_type,action,occurred_at,sequence,source,actor_id,server_accepted_at,client_created_at,command_id,idempotency_key,device_id,is_open,company_id)
    VALUES(extensions.gen_random_uuid()::text,current_deur.id,open_activity,'end',now_at,next_sequence,'server',auth.uid()::text,now_at,nullif(command->>'clientCreatedAt','')::timestamptz,command->>'commandId',command->>'idempotencyKey',command->>'deviceId',false,tenant);
    next_sequence:=next_sequence+1;
  END IF;
  INSERT INTO erp.deur_events(id,deur_id,activity_type,action,occurred_at,sequence,source,actor_id,server_accepted_at,client_created_at,command_id,idempotency_key,device_id,is_open,company_id)
  VALUES(extensions.gen_random_uuid()::text,current_deur.id,'shift','end',now_at,next_sequence,'server',auth.uid()::text,now_at,nullif(command->>'clientCreatedAt','')::timestamptz,command->>'commandId',command->>'idempotencyKey',command->>'deviceId',false,tenant);
  UPDATE erp.deurs AS deur_record
  SET closing_meter=CASE WHEN meter_requirement IN ('hourMeter','odometer') THEN closing_value ELSE deur_record.closing_meter END,
      updated_at=now_at,updated_by=auth.uid()::text
  WHERE deur_record.id=current_deur.id
  RETURNING * INTO current_deur;
  INSERT INTO erp.audit_log(id,aggregate_type,aggregate_id,action,actor_id,occurred_at,correlation_id,new_values,company_id)
  VALUES(extensions.gen_random_uuid()::text,'DEUR',current_deur.id,'COMPLETE_SHIFT',auth.uid()::text,now_at,command->>'commandId',to_jsonb(current_deur),tenant);
  response:=jsonb_build_object('success',true,'disposition','ACCEPTED','record',to_jsonb(current_deur),'version',current_deur.row_version,'serverOccurredAt',now_at);
  RETURN erp.finish_deur_command(command,'COMPLETE_SHIFT',current_deur.id,payload_hash,response);
END $$;

ALTER FUNCTION erp.command_complete_deur_shift(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_complete_deur_shift(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_complete_deur_shift(jsonb) TO authenticated;

-- Preserve turnover/custody identity while adding the same server-stored
-- opening and closing readings used by the normal Operator work projection.
CREATE OR REPLACE FUNCTION erp.read_current_operator_deur_turnover_work()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=erp,auth,extensions,pg_catalog AS $$
DECLARE tenant text:=erp.current_company_id(); actor erp.users%ROWTYPE; work_items jsonb:='[]'::jsonb;
BEGIN
  IF tenant IS NULL OR auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'code','UNAUTHENTICATED'); END IF;
  SELECT * INTO actor FROM erp.users u WHERE u.id=auth.uid() AND u.company_id=tenant AND u.status='active';
  IF actor.id IS NULL OR actor.operator_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','OPERATOR_LINK_REQUIRED'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'turnoverId',t.id,'turnoverStatus',t.status,'turnoverToOperatorId',t.to_operator_id,
    'primaryOperatorId',d.operator_id,'primaryOperatorDisplayName',primary_operator.name,
    'currentAuthorizedOperatorId',erp.resolve_deur_authorized_operator(d.id,tenant),'currentAuthorizedOperatorDisplayName',current_operator.name,
    'deur',jsonb_build_object('id',d.id,'deurNumber',d.deur_number,'rentalId',d.rental_id,'rentalEquipmentLineId',d.rental_equipment_line_id,'assignmentId',d.assignment_id,'equipmentId',d.equipment_id,'workDate',d.work_date,'status',d.status,'version',d.row_version,'operatorId',d.operator_id,'openingMeter',d.opening_meter,'closingMeter',d.closing_meter,'activeActivity',(SELECT event.activity_type FROM erp.deur_events event WHERE event.deur_id=d.id AND event.is_open AND event.activity_type IN ('operation','idle','standby','mealBreak','breakdown') ORDER BY event.sequence DESC LIMIT 1)),
    'line',jsonb_build_object('id',l.id,'rentalId',l.rental_id,'equipmentId',l.equipment_id,'assignmentId',l.assignment_id,'primaryOperatorId',l.operator_id,'status',l.status,'operationalMetadata',l.operational_metadata),
    'assignment',jsonb_build_object('id',a.id,'projectId',a.project_id,'status',a.status),
    'equipment',jsonb_build_object('id',e.id,'name',e.equipment_name,'assetNumber',e.asset_no,'currentReading',e.current_reading),
    'rental',jsonb_build_object('id',r.id,'rentalNumber',r.rental_number,'status',r.status)
  ) ORDER BY t.initiated_at,t.id),'[]'::jsonb) INTO work_items
  FROM erp.deur_turnovers t
  JOIN erp.deurs d ON d.id=t.deur_id AND d.company_id=tenant AND d.previous_revision_id IS NULL
  JOIN erp.rental_equipment_lines l ON l.id=d.rental_equipment_line_id
  JOIN erp.assignments a ON a.id=d.assignment_id AND a.company_id=tenant
  JOIN erp.equipment e ON e.id=d.equipment_id AND e.company_id=tenant
  JOIN erp.rentals r ON r.id=d.rental_id AND r.company_id=tenant
  LEFT JOIN erp.operators primary_operator ON primary_operator.id=d.operator_id AND primary_operator.company_id=tenant
  LEFT JOIN erp.operators current_operator ON current_operator.id=erp.resolve_deur_authorized_operator(d.id,tenant) AND current_operator.company_id=tenant
  WHERE t.company_id=tenant AND (t.from_operator_id=actor.operator_id OR t.to_operator_id=actor.operator_id)
    AND t.status IN ('PENDING','ACCEPTED');
  RETURN jsonb_build_object('success',true,'operatorId',actor.operator_id,'work',work_items);
END $$;

ALTER FUNCTION erp.read_current_operator_deur_turnover_work() OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.read_current_operator_deur_turnover_work() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.read_current_operator_deur_turnover_work() TO authenticated;

COMMIT;
