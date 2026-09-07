import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyContext } from "@/app/composition/dependencyContext";
import { PersistenceMode, type ApplicationDependencies } from "@/app/composition/ApplicationDependencies";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";
import type { CanonicalCommandResult, CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import type { RentalRecord } from "@/features/rental/types";
import { SupabaseCanonicalRentalRepository } from "@/integrations/supabase/SupabaseCanonicalRentalRepository";

const auth = vi.hoisted(() => ({ permissions: new Set<string>(["rental.activate"]) }));
const mocks = vi.hoisted(() => ({ showToast: vi.fn(), refresh: vi.fn(), transitionRental: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", name: "Admin" }, hasPermission: (permission: string) => auth.permissions.has(permission) }) }));
vi.mock("@/components/ui/toast/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/features/rental/context/RentalContext", () => ({ useRental: () => ({ transitionRental: mocks.transitionRental, returnRental: vi.fn(), releaseRental: vi.fn(), submitForApproval: vi.fn(), approveRental: vi.fn(), rejectRental: vi.fn(), getReleaseReadiness: () => ({ eligible: true }) }) }));
vi.mock("@/features/rental/remote/canonicalRentalRefresh", () => ({ requestCanonicalRentalRefresh: mocks.refresh }));

const migration = readFileSync("supabase/migrations/20260825000500_canonical_rental_activate_catalog_authorization.sql", "utf8");
const catalog = JSON.parse(readFileSync("docs/rbac/role-permission-matrix.json", "utf8")) as { grants: Record<string, { allPermissions?: boolean; standard?: Record<string, string[]>; workflow?: string[] }> };
const roots: Root[] = [];
const released = { id: "rental-1", rentalNumber: "R-1", status: "Released", approvalStatus: "Approved", rowVersion: 7 } as RentalRecord;

function has(role: string, permission: string) { const grant = catalog.grants[role]; return grant?.allPermissions === true || Object.entries(grant?.standard ?? {}).some(([resource, actions]) => actions.includes(permission.slice(resource.length + 1)) && permission.startsWith(`${resource}.`)) || grant?.workflow?.includes(permission) === true; }
function repository(activate = vi.fn(async (): Promise<CanonicalCommandResult> => ({ success: true, disposition: "ACCEPTED", value: { rentalId: released.id, status: "Active", version: 8 } }))): CanonicalRentalRemoteRepository {
  return { activate, readWorkspace: vi.fn(), readReferenceData: vi.fn(), createDraft: vi.fn(), updateTerms: vi.fn(), submitApproval: vi.fn(), decideApproval: vi.fn(), reserve: vi.fn(), release: vi.fn() } as CanonicalRentalRemoteRepository;
}
async function render(rental: RentalRecord, repo: CanonicalRentalRemoteRepository) {
  const container = document.createElement("div");
  const root = createRoot(container); roots.push(root);
  const dependencies = { configuration: { persistenceMode: PersistenceMode.Remote, equipmentStatusSource: "supabase", remoteOperationalWritesEnabled: false, remoteRentalActivateEnabled: true }, commandRepositories: { canonicalRental: repo } } as unknown as ApplicationDependencies;
  await act(async () => root.render(createElement(
    ApplicationDependencyContext.Provider,
    { value: dependencies },
    createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental })),
  )));
  return container;
}

beforeEach(() => { vi.clearAllMocks(); auth.permissions = new Set(["rental.activate"]); });
afterEach(async () => { while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("canonical Rental Activate remediation", () => {
  it("replaces only the wrapper authorization with the canonical permission", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp.command_activate_rental(command jsonb) RETURNS jsonb");
    expect(migration).toContain("'ACTIVATE_RENTAL','Released','Active','rental.activate'");
    expect(migration).not.toContain("rental.manage");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+erp\.role_permissions|UPDATE\s+erp\.role_permissions|DELETE\s+FROM\s+erp\.role_permissions/i);
  });

  it("preserves the Catalog 2 role boundary", () => {
    expect(has("system-administrator", "rental.activate")).toBe(true);
    for (const role of ["operations-manager", "dispatcher", "equipment-coordinator", "operator", "billing-staff"]) expect(has(role, "rental.activate"), role).toBe(false);
    expect(migration).not.toContain("finance");
  });

  it("maps the canonical adapter to the existing Activate RPC exactly once", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, disposition: "ACCEPTED", value: { rentalId: released.id, status: "Active", version: 8 } }, error: null });
    await new SupabaseCanonicalRentalRepository({ schema: () => ({ rpc }) } as never).activate({ commandId: "c", idempotencyKey: "i", rentalId: released.id, expectedVersion: 7 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("command_activate_rental", { command: { commandId: "c", idempotencyKey: "i", rentalId: released.id, expectedVersion: 7 } });
  });

  it("shows Activate only for an authorized Released Rental and uses no legacy transition", async () => {
    const activate = vi.fn(async () => ({ success: true, disposition: "ACCEPTED", value: { rentalId: released.id, status: "Active", version: 8 } } as const));
    const container = await render(released, repository(activate));
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Activate Rental");
    expect(button).toBeTruthy();
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ rentalId: released.id, expectedVersion: 7, commandId: expect.any(String), idempotencyKey: expect.any(String) }));
    expect(mocks.transitionRental).not.toHaveBeenCalled();
  });

  it("submits only once while Activate is pending and clears Working on success", async () => {
    let resolve!: (value: CanonicalCommandResult) => void;
    const completion = new Promise<CanonicalCommandResult>(accept => { resolve = accept; });
    const activate = vi.fn(() => completion); const container = await render(released, repository(activate));
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Activate Rental")!;
    await act(async () => { button.click(); button.click(); await Promise.resolve(); });
    expect(activate).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("Working…");
    await act(async () => resolve({ success: true, disposition: "ACCEPTED", value: { rentalId: released.id, status: "Active", version: 8 } }));
    expect(container.textContent).toContain("Activate Rental"); expect(container.textContent).not.toContain("Working…");
  });

  it("hides Activate without authority and for Reserved or Active states", async () => {
    auth.permissions.clear();
    expect((await render(released, repository())).textContent).not.toContain("Activate Rental");
    auth.permissions.add("rental.activate");
    expect((await render({ ...released, status: "Reserved" }, repository())).textContent).not.toContain("Activate Rental");
    expect((await render({ ...released, status: "Active" }, repository())).textContent).not.toContain("Activate Rental");
  });

  it("keeps Activate hidden when the dedicated capability is disabled", async () => {
    const container = document.createElement("div");
    const root = createRoot(container); roots.push(root);
    const dependencies = { configuration: { persistenceMode: PersistenceMode.Remote, equipmentStatusSource: "supabase", remoteOperationalWritesEnabled: false, remoteRentalActivateEnabled: false }, commandRepositories: { canonicalRental: repository() } } as unknown as ApplicationDependencies;
    await act(async () => root.render(createElement(ApplicationDependencyContext.Provider, { value: dependencies }, createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental: released })) )));
    expect(container.textContent).not.toContain("Activate Rental");
  });

  it.each([
    ["authorization", { success: false, code: "FORBIDDEN", message: "denied" }],
    ["stale version", { success: false, code: "CONFLICT", message: "stale", currentVersion: 8 }],
  ] as const)("clears Working after %s failure", async (_name, result) => {
    const activate = vi.fn(async () => result as CanonicalCommandResult); const container = await render(released, repository(activate));
    await act(async () => { [...container.querySelectorAll("button")].find(item => item.textContent === "Activate Rental")?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Activate Rental"); expect(container.textContent).not.toContain("Working…"); expect(mocks.showToast).toHaveBeenCalledWith(result.message, "error");
  });

  it("clears Working after infrastructure failure", async () => {
    const activate = vi.fn(async () => { throw new Error("offline"); }); const container = await render(released, repository(activate));
    await act(async () => { [...container.querySelectorAll("button")].find(item => item.textContent === "Activate Rental")?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Activate Rental"); expect(container.textContent).not.toContain("Working…"); expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("Confirmation was not received"), "error");
  });
});
