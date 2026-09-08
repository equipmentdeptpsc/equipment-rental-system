BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

-- The contact belongs to the Rental as frozen review-recipient evidence.  Extend
-- the already-deployed command rather than changing Customer master data.
DO $$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('erp.command_create_draft_rental(jsonb)'::regprocedure);

  IF definition NOT LIKE '%CREATE_DRAFT_RENTAL%'
    OR definition NOT LIKE '%current_user_has_permission(''rental.create'')%'
    OR definition NOT LIKE '%customer_snapshot,project_snapshot,date_out%'
    OR definition LIKE '%customer_review_name_snapshot%'
  THEN
    RAISE EXCEPTION 'Unexpected command_create_draft_rental definition for review-contact snapshot extension';
  END IF;

  definition := replace(
    definition,
    'OR nullif(btrim(command->>''dateOut''),'''') IS NULL OR command->>''rentalType'' NOT IN(''Bare Rental'',''Operated Rental'')',
    'OR nullif(btrim(command->>''dateOut''),'''') IS NULL OR command->>''rentalType'' NOT IN(''Bare Rental'',''Operated Rental'')'
    || ' OR length(btrim(coalesce(command->>''representativeName'',''''))) NOT BETWEEN 1 AND 200'
    || ' OR btrim(coalesce(command->>''representativeName'','''')) ~ E''[\\r\\n]'''
    || ' OR length(lower(btrim(coalesce(command->>''representativeEmail'','''')))) NOT BETWEEN 3 AND 254'
    || ' OR lower(btrim(coalesce(command->>''representativeEmail'',''''))) ~ E''[\\r\\n]'''
    || ' OR lower(btrim(coalesce(command->>''representativeEmail'',''''))) !~ ''^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'''
  );
  IF definition NOT LIKE '%representativeName%representativeEmail%' THEN
    RAISE EXCEPTION 'Review-contact validation extension did not match command_create_draft_rental';
  END IF;

  definition := replace(
    definition,
    'INSERT INTO erp.rentals(id,rental_number,customer_id,project_id,customer_snapshot,project_snapshot,date_out,expected_return,rental_type,status,approval_status,created_by,updated_by,company_id)',
    'INSERT INTO erp.rentals(id,rental_number,customer_id,project_id,customer_snapshot,project_snapshot,date_out,expected_return,rental_type,status,approval_status,customer_review_name_snapshot,customer_review_email_snapshot,customer_review_contact_captured_at,created_by,updated_by,company_id)'
  );
  definition := replace(
    definition,
    'VALUES(target_id,number_value,customer_row.id,project_row.id,customer_row.name,project_row.name,(command->>''dateOut'')::date,nullif(command->>''expectedReturn'','''')::date,command->>''rentalType'',''Draft'',''NotSubmitted'',actor,actor,tenant)',
    'VALUES(target_id,number_value,customer_row.id,project_row.id,customer_row.name,project_row.name,(command->>''dateOut'')::date,nullif(command->>''expectedReturn'','''')::date,command->>''rentalType'',''Draft'',''NotSubmitted'',btrim(command->>''representativeName''),lower(btrim(command->>''representativeEmail'')),now_at,actor,actor,tenant)'
  );
  IF definition NOT LIKE '%customer_review_name_snapshot,customer_review_email_snapshot,customer_review_contact_captured_at%'
    OR definition NOT LIKE '%lower(btrim(command->>''representativeEmail''))%'
  THEN
    RAISE EXCEPTION 'Review-contact snapshot persistence extension did not match command_create_draft_rental';
  END IF;

  EXECUTE definition;
END $$;

ALTER FUNCTION erp.command_create_draft_rental(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_create_draft_rental(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated;
COMMENT ON FUNCTION erp.command_create_draft_rental(jsonb) IS
  'Creates a Draft Rental with tenant-derived authority, idempotency, interval enforcement, and an immutable Rental-specific Customer Review contact snapshot.';
COMMIT;
