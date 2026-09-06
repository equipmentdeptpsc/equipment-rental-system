BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

DO $$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('erp.command_create_draft_rental(jsonb)'::regprocedure);

  IF definition NOT LIKE '%CREATE_DRAFT_RENTAL%'
    OR definition NOT LIKE '%current_user_has_permission(''rental.manage'')%'
    OR definition LIKE '%current_user_has_permission(''rental.create'')%'
  THEN
    RAISE EXCEPTION 'Unexpected command_create_draft_rental authorization definition';
  END IF;

  definition := replace(
    definition,
    'current_user_has_permission(''rental.manage'')',
    'current_user_has_permission(''rental.create'')'
  );

  EXECUTE definition;
END $$;

ALTER FUNCTION erp.command_create_draft_rental(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_create_draft_rental(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated;
COMMIT;
