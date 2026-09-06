import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260906000300_write_rental_line_actual_return_date.sql", "utf8");

describe("canonical per-line actual return evidence", () => {
  it("requires an explicit ISO business date and preserves the existing return authority", () => {
    expect(migration).toContain("command->>'actualReturnDate'");
    expect(migration).toContain("'^\\d{4}-\\d{2}-\\d{2}$'");
    expect(migration).toContain("return_business_date < rental.date_out");
    expect(migration).toContain("current_user_has_permission('rental.return')");
    expect(migration).toContain("company_id=tenant");
  });

  it("writes the line date atomically with line return and linked Assignment completion", () => {
    expect(migration).toContain("SET status='Returned',actual_return_date=return_business_date");
    expect(migration).toContain("SET status='Completed',returned_date=return_business_date");
    expect(migration).toContain("UPDATE erp.rentals AS r SET status='Returned',returned_at=now_at");
    expect(migration).not.toMatch(/UPDATE\s+erp\.rental_equipment_lines\s+SET\s+actual_return_date[^\n]+WHERE\s+status='Returned'/i);
  });

  it("prevents authoritative date overwrite while allowing identical-date completion", () => {
    expect(migration).toContain("line.status='Returned'");
    expect(migration).toContain("line.actual_return_date IS DISTINCT FROM return_business_date");
    expect(migration).toContain("'Authoritative Return business date is already recorded and cannot be overwritten.'");
    expect(migration).toContain("'ALREADY_COMPLETED'");
  });

  it("passes the exact date through aggregate return without historical backfill", () => {
    expect(migration).toContain("'actualReturnDate',command->>'actualReturnDate'");
    expect(migration).not.toMatch(/UPDATE\s+erp\.rental_equipment_lines[\s\S]*?WHERE\s+actual_return_date\s+IS\s+NULL/i);
  });
});
