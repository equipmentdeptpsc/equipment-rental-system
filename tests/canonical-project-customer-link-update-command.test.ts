import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PersistenceMode } from "../src/app/composition";
import { SupabaseProjectCommandRepository } from "../src/integrations/supabase/SupabaseProjectCommandRepository";
import { canLinkProjectCustomer } from "../src/features/project/services/projectRuntimeCapability";

const migration = readFileSync("supabase/migrations/20260907000200_add_canonical_project_customer_link_command.sql", "utf8");

describe("canonical Project Customer-link command", () => {
  it("requires the existing operation-specific Project update permission and tenant-safe Customer lookup", () => {
    expect(migration).toContain("erp.current_user_has_permission('project.update')");
    expect(migration).toContain("FROM erp.projects WHERE id=command->>'projectId' AND company_id=tenant FOR UPDATE");
    expect(migration).toContain("FROM erp.customers WHERE id=command->>'customerId' AND company_id=tenant AND active AND deleted_at IS NULL");
    expect(migration).toContain("CUSTOMER_INVALID");
  });

  it("allows only NULL-to-Customer linking, makes same-Customer commands idempotent, and rejects relinking", () => {
    expect(migration).toContain("target_project.customer_id IS NOT NULL AND target_project.customer_id<>command->>'customerId'");
    expect(migration).toContain("CUSTOMER_RELINK_NOT_ALLOWED");
    expect(migration).toContain("target_project.customer_id=target_customer.id");
    expect(migration).toContain("erp.begin_operational_command(command,'UPDATE_PROJECT_CUSTOMER','PROJECT'");
  });

  it("updates only Project linkage and audit/version fields", () => {
    expect(migration).toContain("UPDATE erp.projects SET customer_id=target_customer.id,updated_by=actor,updated_at=now_at,row_version=row_version+1");
    expect(migration).toContain("'PROJECT_CUSTOMER_LINKED'");
    expect(migration).not.toMatch(/UPDATE erp\.(assignments|rentals|deurs|equipment|operators)/);
  });

  it("uses only the dedicated capability in remote mode", () => {
    expect(canLinkProjectCustomer({ persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteProjectCustomerLinkEnabled: false } as never, true)).toBe(false);
    expect(canLinkProjectCustomer({ persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteProjectCustomerLinkEnabled: true } as never, true)).toBe(true);
    expect(canLinkProjectCustomer({ persistenceMode: PersistenceMode.Local, remoteOperationalWritesEnabled: false, remoteProjectCustomerLinkEnabled: true } as never, true)).toBe(false);
  });

  it("uses the canonical RPC rather than a direct table write", async () => {
    const rpc = vi.fn(async () => ({ data: { success: true, disposition: "ACCEPTED", serverOccurredAt: "2026-09-07T00:00:00Z", refresh: ["project"], value: { id: "project", companyId: "tenant", customerId: "customer", rowVersion: 2 } }, error: null }));
    const repository = new SupabaseProjectCommandRepository({ schema: () => ({ rpc }) });
    await expect(repository.updateProjectCustomer({ projectId: "project", customerId: "customer", expectedVersion: 1, commandId: "command", idempotencyKey: "key" })).resolves.toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledWith("command_update_project_customer", expect.anything());
  });
});
