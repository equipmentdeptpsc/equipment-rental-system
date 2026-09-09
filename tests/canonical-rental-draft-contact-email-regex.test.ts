import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260908000600_fix_rental_draft_contact_email_regex.sql", "utf8");

describe("canonical Rental draft contact email regex correction", () => {
  it("is a forward-only function replacement guarded by the diagnostic contact branch", () => {
    expect(sql).toContain("pg_get_functiondef('erp.command_create_draft_rental(jsonb)'::regprocedure)");
    expect(sql).toContain("INVALID_CONTACT");
    expect(sql).toContain("definition := replace");
    expect(sql).toContain("EXECUTE definition");
  });

  it("corrects only the escaped domain dot and preserves the canonical boundary", () => {
    expect(sql).toContain("definition := replace(definition");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated");
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toContain("DROP FUNCTION");
  });
});
