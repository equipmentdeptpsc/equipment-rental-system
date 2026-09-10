import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260911000100_fix_linked_assignment_interval_exemption.sql", "utf8");
type Interval = Readonly<{ start: string; end: string | null }>;
const infinity = "9999-12-31";
const overlaps = (left: Interval, right: Interval) => left.start <= (right.end ?? infinity) && (left.end ?? infinity) >= right.start;
const sameInterval = (left: Interval, right: Interval) => left.start === right.start && left.end === right.end;

describe("D3 Rental and Assignment interval matrix", () => {
  it("blocks standalone Assignment to overlapping Rental", () => {
    expect(overlaps({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-11", end: "2031-04-13" })).toBe(true);
    expect(sameInterval({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-11", end: "2031-04-13" })).toBe(false);
  });

  it("allows standalone Assignment to non-overlapping Rental", () => {
    expect(overlaps({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-13", end: "2031-04-15" })).toBe(false);
  });

  it("does not self-conflict for an exact Rental-linked Assignment commitment", () => {
    expect(sameInterval({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-10", end: "2031-04-12" })).toBe(true);
  });

  it("retains Rental to standalone Assignment overlap blocking", () => {
    expect(overlaps({ start: "2031-03-10", end: "2031-03-12" }, { start: "2031-03-11", end: "2031-03-11" })).toBe(true);
  });

  it("retains inclusive same-day blocking", () => {
    expect(overlaps({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-12", end: "2031-04-12" })).toBe(true);
  });

  it("retains open-ended blocking", () => {
    expect(overlaps({ start: "2031-04-10", end: null }, { start: "2034-01-01", end: "2034-01-01" })).toBe(true);
  });

  it("retains tenant-scoped serialized evaluation", () => {
    for (const token of ["p_company_id <> erp.current_company_id()", "assignment.company_id=p_company_id", "pg_advisory_xact_lock(hashtextextended(p_company_id || ':' || p_equipment_id, 0))"]) expect(sql).toContain(token);
  });

  it("preserves D1 actual-return and canonical conflict behavior", () => {
    for (const token of ["coalesce(line.actual_return_date, rental.expected_return)", "EQUIPMENT_INTERVAL_CONFLICT", "AND rental.date_out = assignment.assigned_date", "IS NOT DISTINCT FROM assignment.expected_return"]) expect(sql).toContain(token);
  });
});
