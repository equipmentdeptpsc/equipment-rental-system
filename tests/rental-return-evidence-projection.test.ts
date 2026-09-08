import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Rental Return evidence projection", () => {
  const sql = readFileSync("supabase/migrations/20260908000100_read_rental_return_evidence.sql", "utf8");
  const ui = readFileSync("src/features/rental/workspace/components/RentalReturnEvidence.tsx", "utf8");
  it("is authenticated, tenant-derived, read-only, and delegates date windows to D1", () => {
    expect(sql).toContain("erp.current_company_id()");
    expect(sql).toContain("erp.current_user_has_permission('rental.read')");
    expect(sql).toContain("erp.check_equipment_availability");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
  it("renders canonical post-return facts without controls or local fallback", () => {
    expect(ui).toContain("Actual return date");
    expect(ui).toContain("Availability next day");
    expect(ui).not.toMatch(/button|onClick|localStorage/i);
  });
});
