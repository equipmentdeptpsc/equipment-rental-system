import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260911000100_fix_linked_assignment_interval_exemption.sql", "utf8");

type Interval = Readonly<{ start: string; end: string | null }>;

const overlaps = (left: Interval, right: Interval) =>
  left.start <= (right.end ?? "9999-12-31") && (left.end ?? "9999-12-31") >= right.start;

const sameCommitment = (assignment: Interval, rental: Interval) =>
  assignment.start === rental.start && assignment.end === rental.end;

describe("Rental and standalone Assignment interval boundary", () => {
  it("blocks an overlapping standalone Assignment when the new Rental merely references it", () => {
    const assignment = { start: "2031-04-10", end: "2031-04-12" };
    const rental = { start: "2031-04-11", end: "2031-04-13" };
    expect(overlaps(assignment, rental)).toBe(true);
    expect(sameCommitment(assignment, rental)).toBe(false);
    expect(sql).toContain("AND assignment.assigned_date = rental.date_out");
    expect(sql).toContain("NULL, v_exclude_assignment_id");
  });

  it("allows a non-overlapping Rental while retaining a standalone Assignment commitment", () => {
    expect(overlaps({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-13", end: "2031-04-15" })).toBe(false);
    expect(sql).toContain("assignment.id IS DISTINCT FROM p_exclude_assignment_id");
  });

  it("deduplicates only a legitimate equal-interval Rental-linked Assignment", () => {
    expect(sameCommitment({ start: "2031-04-10", end: "2031-04-12" }, { start: "2031-04-10", end: "2031-04-12" })).toBe(true);
    expect(sql).toContain("COALESCE(line.actual_return_date, rental.expected_return) IS NOT DISTINCT FROM assignment.expected_return");
  });

  it("retains D1 reciprocal, inclusive, open-ended, tenant, and actual-return semantics", () => {
    expect(overlaps({ start: "2031-04-11", end: "2031-04-11" }, { start: "2031-04-10", end: "2031-04-12" })).toBe(true);
    expect(overlaps({ start: "2031-04-10", end: null }, { start: "2032-01-01", end: "2032-01-01" })).toBe(true);
    for (const token of [
      "line.company_id=p_company_id AND line.equipment_id=p_equipment_id",
      "coalesce(line.actual_return_date, rental.expected_return)",
      "coalesce(p_requested_end, 'infinity'::date)",
      "coalesce(commitment.ends_on, 'infinity'::date) >= p_requested_start",
      "pg_advisory_xact_lock(hashtextextended(p_company_id || ':' || p_equipment_id, 0))",
    ]) expect(sql).toContain(token);
  });
});
