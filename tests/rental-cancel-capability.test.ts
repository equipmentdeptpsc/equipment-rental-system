import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyContext } from "@/app/composition/dependencyContext";
import { PersistenceMode, createLocalApplicationDependencies, type ApplicationDependencies } from "@/app/composition";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";
import { canUseCanonicalRemoteRentalCancelMutation, canUseCanonicalRemoteRentalReleaseMutation, canUseCanonicalRemoteRentalReturnMutation } from "@/features/rental/services/rentalRuntimeCapability";
import { createSupabaseRentalCancellationCommands } from "@/integrations/supabase/SupabaseOperationalCommandRepository";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), toast: vi.fn(), refresh: vi.fn(), allowRentalUpdate: true }));

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "uat-admin", name: "UAT Administrator" }, hasPermission: (permission: string) => permission === "rental.update" && mocks.allowRentalUpdate }) }));
vi.mock("@/components/ui/toast/ToastContext", () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock("@/features/rental/context/RentalContext", () => ({ useRental: () => ({ transitionRental: vi.fn(), returnRental: vi.fn(), releaseRental: vi.fn(), submitForApproval: vi.fn(), approveRental: vi.fn(), rejectRental: vi.fn(), getReleaseReadiness: () => ({ eligible: true }) }) }));
vi.mock("@/features/rental/remote/canonicalRentalRefresh", () => ({ requestCanonicalRentalRefresh: mocks.refresh }));

const rental = { id: "970add3a-2d2d-4ced-9e92-f5af39db3987", rentalNumber: "RNT-2026-000005", status: "Draft", approvalStatus: "NotSubmitted", rowVersion: 1 } as never;
const roots: Root[] = [];

function dependencies(cancelEnabled: boolean): ApplicationDependencies {
  return {
    configuration: { persistenceMode: PersistenceMode.Remote, equipmentStatusSource: "supabase", remoteOperationalWritesEnabled: false, remoteRentalCancelEnabled: cancelEnabled },
    commandRepositories: { canonicalRental: {}, rentalLifecycleCommands: { cancel: mocks.cancel } },
  } as unknown as ApplicationDependencies;
}

async function render(cancelEnabled: boolean) {
  const container = document.createElement("div");
  const root = createRoot(container); roots.push(root);
  await act(async () => {
    root.render(createElement(ApplicationDependencyContext.Provider, { value: dependencies(cancelEnabled) }, createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental }))));
  });
  return container;
}

afterEach(async () => { vi.clearAllMocks(); mocks.allowRentalUpdate = true; while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("narrow remote Rental cancellation capability", () => {
  it("is fail-closed and does not enable unrelated operational capabilities", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(local.remoteRentalCancelEnabled).toBe(false);
    expect(canUseCanonicalRemoteRentalCancelMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalCancelMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalCancelEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalCancelMutation({ ...local, persistenceMode: PersistenceMode.Local, remoteRentalCancelEnabled: true })).toBe(false);
    expect(canUseCanonicalRemoteRentalReleaseMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalCancelEnabled: true })).toBe(false);
    expect(canUseCanonicalRemoteRentalReturnMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalCancelEnabled: true })).toBe(false);
  });

  it("hides Cancel when disabled and shows only Cancel when enabled with rental.update", async () => {
    expect((await render(false)).textContent).toBe("");
    const container = await render(true);
    expect(container.textContent).toContain("Cancel Rental");
    expect(container.textContent).not.toContain("Reserve Rental");
    expect(container.textContent).not.toContain("Release Equipment");
    expect(container.textContent).not.toContain("Return Equipment");
  });

  it("hides Cancel for a user without rental.update", async () => {
    mocks.allowRentalUpdate = false;
    expect((await render(true)).textContent).toBe("");
  });

  it("calls only the existing canonical cancellation command with optimistic versioning", async () => {
    mocks.cancel.mockResolvedValue({ success: true, disposition: "ACCEPTED", serverOccurredAt: "2031-04-01T00:00:00Z", refresh: [rental.id], value: { rentalId: rental.id, status: "Cancelled", version: 2 } });
    const container = await render(true);
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Cancel Rental")?.click(); await Promise.resolve(); });
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ rentalId: rental.id, expectedVersion: 1, commandId: expect.any(String), idempotencyKey: expect.any(String) }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the RPC surface limited to command_cancel_rental", async () => {
    const rpc = vi.fn(async () => ({ data: { success: true, disposition: "ACCEPTED", serverOccurredAt: "2031-04-01T00:00:00Z", refresh: [rental.id], value: { rentalId: rental.id, status: "Cancelled", version: 2 } }, error: null }));
    await createSupabaseRentalCancellationCommands({ schema: () => ({ rpc }) }).cancel({ rentalId: rental.id, expectedVersion: 1, commandId: "cancel", idempotencyKey: "cancel" });
    expect(rpc).toHaveBeenCalledWith("command_cancel_rental", { command: expect.objectContaining({ rentalId: rental.id, expectedVersion: 1 }) });
  });
});
