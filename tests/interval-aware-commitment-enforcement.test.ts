import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260908000200_enforce_equipment_commitment_intervals.sql", "utf8");

describe("interval-aware commitment enforcement", () => {
  it("uses D1 inclusive, open-ended, actual-return, and linked-assignment semantics", () => {
    for (const token of ["line.actual_return_date, rental.expected_return", "coalesce(p_requested_end, 'infinity'::date)", "coalesce(commitment.ends_on, 'infinity'::date) >= p_requested_start", "NOT EXISTS (", "line.assignment_id=assignment.id"]) expect(sql).toContain(token);
  });
  it("serializes tenant-equipment writes and keeps the helper internal", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_company_id || ':' || p_equipment_id, 0))");
    expect(sql).toContain("REVOKE ALL ON FUNCTION erp.assert_equipment_interval_available");
    expect(sql).toContain("EQUIPMENT_INTERVAL_CONFLICT");
  });
  it("replaces broad current-state exclusivity at both create boundaries", () => {
    expect(sql).toContain("DROP INDEX IF EXISTS erp.uq_rental_lines_company_non_final_equipment");
    expect(sql).toContain("DROP INDEX IF EXISTS erp.uq_assignment_active_equipment");
    expect(sql).toContain("enforce_rental_line_commitment_interval BEFORE INSERT");
    expect(sql).toContain("enforce_assignment_commitment_interval BEFORE INSERT");
  });
});
