import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyContext } from "@/app/composition/dependencyContext";
import { PersistenceMode, type ApplicationDependencies } from "@/app/composition/ApplicationDependencies";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";
import type { CanonicalRentalReleaseReadiness, CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import type { RentalRecord } from "@/features/rental/types";

const state = vi.hoisted(() => ({ permissions: new Set<string>(["rental.release"]), localReady: false }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", name: "Admin" }, hasPermission: (permission: string) => state.permissions.has(permission) }) }));
vi.mock("@/components/ui/toast/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/features/rental/context/RentalContext", () => ({ useRental: () => ({ transitionRental: vi.fn(), returnRental: vi.fn(), releaseRental: vi.fn(), submitForApproval: vi.fn(), approveRental: vi.fn(), rejectRental: vi.fn(), getReleaseReadiness: () => ({ eligible: state.localReady }) }) }));
vi.mock("@/features/rental/remote/canonicalRentalRefresh", () => ({ requestCanonicalRentalRefresh: vi.fn() }));

const rental = { id: "rental-1", rentalNumber: "RNT-1", status: "Reserved", approvalStatus: "Approved", rowVersion: 5 } as RentalRecord;
const roots: Root[] = [];

function readiness(eligible: boolean): CanonicalRentalReleaseReadiness {
  return { rentalId: rental.id, eligible, reasonCodes: eligible ? [] : ["RELEASE_NOT_READY"], incompleteEquipmentLines: eligible ? [] : [{ rentalEquipmentLineId: "line-1", missingFields: ["snapshotFreshness"], invalidValues: [] }] };
}

function repository(getReleaseReadiness = vi.fn(async () => ({ success: true as const, value: readiness(true) }))): CanonicalRentalRemoteRepository {
  return {
    getReleaseReadiness, readWorkspace: vi.fn(), readReferenceData: vi.fn(), createDraft: vi.fn(), updateTerms: vi.fn(),
    submitApproval: vi.fn(), decideApproval: vi.fn(), reserve: vi.fn(), release: vi.fn(), activate: vi.fn(),
  } as CanonicalRentalRemoteRepository;
}

async function render(repo: CanonicalRentalRemoteRepository, mode = PersistenceMode.Remote) {
  const container = document.createElement("div"); const root = createRoot(container); roots.push(root);
  const dependencies = { configuration: { persistenceMode: mode, equipmentStatusSource: mode === PersistenceMode.Remote ? "supabase" : "local", remoteOperationalWritesEnabled: false, remoteRentalReleaseEnabled: mode === PersistenceMode.Remote }, commandRepositories: { canonicalRental: repo } } as unknown as ApplicationDependencies;
  await act(async () => { root.render(createElement(ApplicationDependencyContext.Provider, { value: dependencies }, createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental })))); await Promise.resolve(); });
  return container;
}

function releaseButton(container: HTMLDivElement) { const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Release Equipment"); if (!button) throw new Error("Release control not found"); return button as HTMLButtonElement; }

beforeEach(() => { vi.clearAllMocks(); state.permissions = new Set(["rental.release"]); state.localReady = false; });
afterEach(async () => { while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("remote Release-readiness projection", () => {
  it("enables narrow remote Release when canonical readiness is ready despite stale local state", async () => {
    const getReleaseReadiness = vi.fn(async () => ({ success: true as const, value: readiness(true) }));
    const container = await render(repository(getReleaseReadiness));
    expect(releaseButton(container).disabled).toBe(false);
    expect(getReleaseReadiness).toHaveBeenCalledTimes(1);
    expect(getReleaseReadiness).toHaveBeenCalledWith(rental.id);
  });

  it("disables remote Release when canonical readiness is not ready despite local state", async () => {
    state.localReady = true;
    const container = await render(repository(vi.fn(async () => ({ success: true as const, value: readiness(false) }))));
    expect(releaseButton(container).disabled).toBe(true);
    expect(releaseButton(container).title).toContain("RELEASE_NOT_READY");
  });

  it("fails closed while canonical readiness is loading or fails", async () => {
    let resolve!: (result: { success: true; value: CanonicalRentalReleaseReadiness }) => void;
    const pending = new Promise<{ success: true; value: CanonicalRentalReleaseReadiness }>(accept => { resolve = accept; });
    const container = await render(repository(vi.fn(() => pending)));
    expect(releaseButton(container).disabled).toBe(true);
    expect(releaseButton(container).title).toContain("Checking canonical Release readiness");
    await act(async () => resolve({ success: true, value: readiness(true) }));
    expect(releaseButton(container).disabled).toBe(false);

    const failed = await render(repository(vi.fn(async () => ({ success: false as const, code: "TRANSPORT_FAILURE" as const, message: "network" }))));
    expect(releaseButton(failed).disabled).toBe(true);
    expect(releaseButton(failed).title).toBe("Release readiness could not be verified.");
  });

  it("does not expose the Release control without the canonical permission", async () => {
    state.permissions.clear();
    const getReleaseReadiness = vi.fn(async () => ({ success: true as const, value: readiness(true) }));
    const container = await render(repository(getReleaseReadiness));
    expect(container.textContent).not.toContain("Release Equipment");
    expect(getReleaseReadiness).not.toHaveBeenCalled();
  });

  it("preserves local Release readiness without a remote read", async () => {
    state.localReady = true;
    const getReleaseReadiness = vi.fn(async () => ({ success: true as const, value: readiness(false) }));
    const container = await render(repository(getReleaseReadiness), PersistenceMode.Local);
    expect(releaseButton(container).disabled).toBe(false);
    expect(getReleaseReadiness).not.toHaveBeenCalled();
  });
});
