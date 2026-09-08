import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260908000300_bootstrap_global_equipment_categories.sql", "utf8");
const reader = readFileSync("src/integrations/supabase/SupabaseEquipmentSubcategoryRepository.ts", "utf8");

const approved = [
  ["d4c032dc-dc09-5a24-87c5-e663645f75ba", "MOV", "Moving Equipment", "1"],
  ["ab695f74-6bc3-56e7-87a8-6ee851a2adc1", "NME", "Non-Moving Equipment", "2"],
  ["ab58d0c5-5b24-5dd6-a105-b90a30202a3f", "AER", "Aerial Equipment", "3"],
  ["c335be47-3619-5d15-8931-ba77bdfd715e", "LTE", "Light Equipment", "4"],
] as const;

describe("global Equipment Category bootstrap", () => {
  it("adds exactly the approved active global catalog with stable identities", () => {
    expect(migration).toContain("INSERT INTO erp.equipment_categories(id,code,name,description,active,sort_order)");
    for (const [id, code, name, order] of approved) {
      expect(migration).toContain(`'${id}','${code}','${name}'`);
      expect(migration).toContain(`true,${order})`);
    }
    expect(migration).not.toContain("Earth Moving");
  });

  it("preserves global system-managed semantics and rejects conflicting legacy identities", () => {
    expect(migration).toContain("global equipment category bootstrap collision");
    expect(migration).toContain("existing.id<>approved.id");
    expect(migration).toContain("ON CONFLICT (id) DO NOTHING");
    expect(migration).not.toMatch(/company_id|ROW LEVEL SECURITY|CREATE (?:OR REPLACE )?FUNCTION|GRANT |REVOKE |\bUNIQUE\b|CREATE INDEX/i);
  });

  it("keeps Category reads available to the canonical Equipment and Sub-Category flows", () => {
    expect(reader).toContain('from("equipment_categories").select("id,name,active")');
    expect(reader).toContain('.eq("active", true)');
    expect(reader).toContain('.order("sort_order")');
  });
});
