import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260908000500_add_rental_draft_validation_diagnostics.sql", "utf8");
const reasons = ["INVALID_COMMAND", "INVALID_CONTACT", "INVALID_LINE_SET", "INVALID_DATE", "INVALID_IDEMPOTENCY_STATE", "INVALID_LINE_SHAPE"];

describe("canonical Rental draft validation diagnostics", () => {
  it("preserves VALIDATION_REJECTED while assigning a stable non-sensitive reason to every existing validation branch", () => {
    for (const reason of reasons) expect(sql).toContain(`'reason','${reason}'`);
    expect(sql.match(/'code','VALIDATION_REJECTED'/g)).toHaveLength(reasons.length);
  });

  it("preserves successful draft creation and non-validation boundary semantics", () => {
    for (const marker of [
      "INSERT INTO erp.rentals",
      "INSERT INTO erp.rental_equipment_lines",
      "RENTAL_DRAFT_CREATED",
      "'code','NOT_FOUND'",
      "'code','MISSING_RELATIONSHIP'",
      "SQLSTATE 'P0001'",
      "'code','EQUIPMENT_INTERVAL_CONFLICT'",
      "erp.finish_operational_command(command,'CREATE_DRAFT_RENTAL'",
    ]) expect(sql).toContain(marker);
  });

  it("retains interval enforcement and does not restore obsolete current-status filtering", () => {
    expect(sql).not.toContain("IF EXISTS(SELECT 1 FROM jsonb_array_elements(command->'lines') x JOIN erp.assignments a ON a.id=x.value->>'assignmentId' JOIN erp.rental_equipment_lines");
    expect(sql).toContain("EQUIPMENT_INTERVAL_CONFLICT");
  });

  it("does not expose database internals or raw values in diagnostic detail", () => {
    expect(sql).not.toMatch(/jsonb_build_object\('reason',[^)]*(command->>|tenant|actor|sqlerrm|stack)/i);
    expect(sql).not.toMatch(/GET STACKED DIAGNOSTICS[^;]*(DETAIL|CONTEXT|MESSAGE_TEXT)/i);
  });
});
