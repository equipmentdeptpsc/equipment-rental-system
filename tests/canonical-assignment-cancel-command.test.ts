import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { SupabaseAssignmentCommandRepository } from "@/integrations/supabase/SupabaseAssignmentCommandRepository";

const sql = readFileSync(resolve("supabase/migrations/20260907000100_add_canonical_assignment_cancel_command.sql"), "utf8");
const command = { commandId: "cancel-command", idempotencyKey: "cancel-key", assignmentId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 };
const projection = { id: command.assignmentId, equipmentId: "equipment-1", operatorId: "operator-1", status: "Cancelled" as const, rowVersion: 2 };

describe("canonical Assignment cancellation command", () => {
  it("uses existing terminal Assignment authority without changing RBAC mappings", () => {
    expect(sql).toContain("erp.current_user_has_permission('assignment.close')");
    expect(sql).not.toContain("INSERT INTO erp.app_permissions");
    expect(sql).not.toContain("INSERT INTO erp.role_permissions");
    expect(sql).not.toContain("assignment.manage");
  });

  it("derives tenant identity, rejects caller scope, and keeps direct writes unavailable", () => {
    expect(sql).toContain("tenant text = erp.current_company_id()");
    expect(sql).toContain("command ?| ARRAY['companyId', 'company_id', 'tenantId', 'tenant_id'");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON erp.assignments FROM PUBLIC, anon, authenticated");
  });

  it("cancels only Active unlinked Assignments without inventing a return date", () => {
    expect(sql).toContain("IF target.status <> 'Active'");
    expect(sql).toContain("rental.status NOT IN ('Returned', 'Closed', 'Cancelled')");
    expect(sql).toContain("SET status = 'Cancelled', updated_by = actor");
    expect(sql).not.toContain("UPDATE erp.assignments SET returned_date");
  });

  it("uses idempotency, optimistic concurrency, one audit event, and canonical equipment release", () => {
    for (const token of ["erp.begin_operational_command(command, 'CANCEL_ASSIGNMENT'", "erp.finish_operational_command(command, 'CANCEL_ASSIGNMENT'", "target.row_version <> (command->>'expectedVersion')::bigint", "'disposition', 'ALREADY_COMPLETED'", "'ASSIGNMENT_CANCELLED'", "previous_values", "SET status_id = available_status", "project_id = NULL", "operator_id = NULL"]) expect(sql).toContain(token);
    expect(sql.match(/INSERT INTO erp\.audit_log/g)).toHaveLength(1);
  });

  it("does not create or mutate Rental, DEUR, Billing, Maintenance, or unrelated Assignments", () => {
    expect(sql).not.toMatch(/INSERT INTO erp\.(rentals|rental_equipment_lines|deurs|billing_|maintenance)/);
    expect(sql).not.toMatch(/UPDATE erp\.(rentals|rental_equipment_lines|deurs|billing_|maintenance)/);
    expect(sql.match(/UPDATE erp\.assignments/g)).toHaveLength(1);
  });
});

describe("canonical Assignment cancellation repository", () => {
  it("calls only the canonical RPC and accepts deterministic cancellation outcomes", async () => {
    for (const disposition of ["ACCEPTED", "REPLAYED", "ALREADY_COMPLETED"] as const) {
      const rpc = vi.fn(async () => ({ data: { success: true, disposition, serverOccurredAt: "2026-09-07T00:00:00Z", refresh: [projection.id], value: projection }, error: null }));
      const repository = new SupabaseAssignmentCommandRepository({ schema: () => ({ rpc }) });
      await expect(repository.cancelAssignment(command)).resolves.toMatchObject({ success: true, disposition, value: projection });
      expect(rpc).toHaveBeenCalledWith("command_cancel_assignment", { command });
    }
  });

  it("reports linked-Rental rejection without a local fallback", async () => {
    const rpc = vi.fn(async () => ({ data: { success: false, code: "RENTAL_CONFLICT" }, error: null }));
    const repository = new SupabaseAssignmentCommandRepository({ schema: () => ({ rpc }) });
    await expect(repository.cancelAssignment(command)).resolves.toMatchObject({ success: false, code: "RENTAL_CONFLICT", retryable: false });
  });
});
