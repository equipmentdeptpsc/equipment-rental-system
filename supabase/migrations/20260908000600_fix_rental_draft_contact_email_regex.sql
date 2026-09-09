BEGIN;
SET LOCAL search_path=erp,auth,extensions,pg_catalog;

DO $$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('erp.command_create_draft_rental(jsonb)'::regprocedure);
  IF definition NOT LIKE '%INVALID_CONTACT%'
     OR definition NOT LIKE '%representativeEmail%'
  THEN
    RAISE EXCEPTION 'Unexpected command_create_draft_rental definition for contact regex correction';
  END IF;
  definition := replace(definition, repeat(chr(92),4)||'.', repeat(chr(92),2)||'.');
  definition := replace(definition, repeat(chr(92),2)||'.', repeat(chr(92),1)||'.');
  IF position(repeat(chr(92),2)||'.' in definition)>0 THEN
    RAISE EXCEPTION 'Contact regex correction did not remove over-escaped dot';
  END IF;
  EXECUTE definition;
END $$;

ALTER FUNCTION erp.command_create_draft_rental(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION erp.command_create_draft_rental(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated;
COMMENT ON FUNCTION erp.command_create_draft_rental(jsonb) IS
  'Creates a Draft Rental with tenant-derived authority, idempotency, interval enforcement, immutable Rental-specific Customer Review contact evidence, and safe validation diagnostics.';
COMMIT;
