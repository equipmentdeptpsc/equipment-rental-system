BEGIN;
SET LOCAL search_path=erp,pg_catalog;

-- Equipment Categories are system-managed global reference data.  This
-- bootstrap intentionally does not add tenancy, RLS, runtime mutation, or a
-- new uniqueness rule.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM erp.equipment_categories existing
    JOIN (
      VALUES
        ('d4c032dc-dc09-5a24-87c5-e663645f75ba', 'Moving Equipment'),
        ('ab695f74-6bc3-56e7-87a8-6ee851a2adc1', 'Non-Moving Equipment'),
        ('ab58d0c5-5b24-5dd6-a105-b90a30202a3f', 'Aerial Equipment'),
        ('c335be47-3619-5d15-8931-ba77bdfd715e', 'Light Equipment')
    ) AS approved(id, name)
      ON lower(existing.name)=lower(approved.name)
     AND existing.id<>approved.id
  ) THEN
    RAISE EXCEPTION 'global equipment category bootstrap collision';
  END IF;
END $$;

INSERT INTO erp.equipment_categories(id,code,name,description,active,sort_order) VALUES
  ('d4c032dc-dc09-5a24-87c5-e663645f75ba','MOV','Moving Equipment','Self-propelled or mobile heavy equipment used for construction, hauling, excavation, lifting, or related field operations.',true,1),
  ('ab695f74-6bc3-56e7-87a8-6ee851a2adc1','NME','Non-Moving Equipment','Stationary or non-self-propelled equipment used for construction, support, processing, power, or site operations.',true,2),
  ('ab58d0c5-5b24-5dd6-a105-b90a30202a3f','AER','Aerial Equipment','Equipment primarily used for elevated access, lifting personnel, or aerial work activities.',true,3),
  ('c335be47-3619-5d15-8931-ba77bdfd715e','LTE','Light Equipment','Portable or relatively small equipment and tools used for construction, maintenance, and field support activities.',true,4)
ON CONFLICT (id) DO NOTHING;

COMMIT;
