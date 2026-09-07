import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const correction = readFileSync("supabase/migrations/20260907000300_fix_canonical_project_customer_link_audit_column.sql", "utf8");
const original = readFileSync("supabase/migrations/20260907000200_add_canonical_project_customer_link_command.sql", "utf8");

describe("canonical Project Customer-link audit schema correction", () => {
  it("uses the deployed audit_log previous_values column and never old_values", () => {
    expect(correction).toContain("previous_values,new_values");
    expect(correction).not.toMatch(/,old_values,new_values/);
    expect(original).toContain("old_values,new_values");
  });

  it("preserves the command contract while replacing the function forward-only", () => {
    expect(correction).toContain("CREATE OR REPLACE FUNCTION erp.command_update_project_customer(command jsonb)");
    expect(correction).toContain("erp.current_user_has_permission('project.update')");
    expect(correction).toContain("erp.begin_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT'");
    expect(correction).toContain("erp.finish_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT'");
    expect(correction).toContain("CUSTOMER_RELINK_NOT_ALLOWED");
    expect(correction).toContain("GRANT EXECUTE ON FUNCTION erp.command_update_project_customer(jsonb) TO authenticated");
  });
});
