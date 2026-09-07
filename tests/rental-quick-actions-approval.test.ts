import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyContext } from "@/app/composition/dependencyContext";
import { PersistenceMode, type ApplicationDependencies } from "@/app/composition/ApplicationDependencies";
import type { CanonicalCommandResult, CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import type { RentalRecord } from "@/features/rental/types";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "b1e5158b-e791-40f9-9447-313bd9e1e700", name: "UAT Operations Manager 001" },
    hasPermission: (permission: string) => permission === "rental.approval.decide",
  }),
}));
vi.mock("@/components/ui/toast/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/features/rental/context/RentalContext", () => ({
  useRental: () => ({
    transitionRental: vi.fn(), returnRental: vi.fn(), releaseRental: vi.fn(), submitForApproval: vi.fn(),
    approveRental: vi.fn(), rejectRental: vi.fn(), getReleaseReadiness: () => ({ eligible: true }),
  }),
}));
vi.mock("@/features/rental/remote/canonicalRentalRefresh", () => ({ requestCanonicalRentalRefresh: mocks.refresh }));

const rental = {
  id: "0ac5c327-2d47-46e9-b94f-2b77deb27427",
  rentalNumber: "RNT-2026-000001",
  status: "Draft",
  approvalStatus: "Pending",
  approvalRequestedById: "8c570101-e232-4151-8d73-e3288a8d3c15",
  rowVersion: 4,
} as RentalRecord;

let roots: Root[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

function dependencies(repository: CanonicalRentalRemoteRepository, remoteOperationalWritesEnabled = true, remoteRentalApprovalEnabled = false): ApplicationDependencies {
  return {
    configuration: { persistenceMode: PersistenceMode.Remote, equipmentStatusSource: "supabase", remoteOperationalWritesEnabled, remoteRentalApprovalEnabled },
    commandRepositories: { canonicalRental: repository },
  } as unknown as ApplicationDependencies;
}

async function render(repository: CanonicalRentalRemoteRepository, remoteOperationalWritesEnabled = true, remoteRentalApprovalEnabled = false) {
  const container = document.createElement("div");
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(createElement(
    ApplicationDependencyContext.Provider,
    { value: dependencies(repository, remoteOperationalWritesEnabled, remoteRentalApprovalEnabled) },
    createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental })),
  )));
  return container;
}

function button(container: HTMLDivElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(item => item.textContent === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function repository(decideApproval: CanonicalRentalRemoteRepository["decideApproval"]): CanonicalRentalRemoteRepository {
  return {
    decideApproval,
    readWorkspace: vi.fn(), readReferenceData: vi.fn(), createDraft: vi.fn(), updateTerms: vi.fn(),
    submitApproval: vi.fn(), reserve: vi.fn(), release: vi.fn(), activate: vi.fn(),
  } as CanonicalRentalRemoteRepository;
}

describe("canonical Rental approval quick action", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => { while (roots.length) await act(async () => roots.pop()?.unmount()); });

  it("submits approval immediately without a blocking native prompt and clears Working on success", async () => {
    const completion = deferred<CanonicalCommandResult>();
    const decideApproval = vi.fn(() => completion.promise);
    const prompt = vi.spyOn(window, "prompt");
    const container = await render(repository(decideApproval));

    await act(async () => { button(container, "Approve Rental").click(); await Promise.resolve(); });

    expect(prompt).not.toHaveBeenCalled();
    expect(decideApproval).toHaveBeenCalledTimes(1);
    expect(decideApproval).toHaveBeenCalledWith(expect.objectContaining({
      rentalId: rental.id, expectedVersion: 4, decision: "Approved",
      commandId: expect.any(String), idempotencyKey: expect.any(String),
    }));
    expect(container.textContent).toContain("Working…");

    await act(async () => completion.resolve({ success: true, disposition: "ACCEPTED", value: { rentalId: rental.id, status: "Draft", approvalStatus: "Approved", version: 5 } }));
    expect(container.textContent).toContain("Approve Rental");
    expect(container.textContent).not.toContain("Working…");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("clears Working and reports a transport failure when the integration throws", async () => {
    const decideApproval = vi.fn(async () => { throw new Error("network unavailable"); });
    const container = await render(repository(decideApproval));

    await act(async () => { button(container, "Approve Rental").click(); await Promise.resolve(); });

    expect(decideApproval).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Working…");
    expect(mocks.showToast).toHaveBeenCalledWith("Confirmation was not received from the remote service. Refresh before retrying.", "error");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("collects a required rejection reason before entering Working and does not submit on cancel", async () => {
    const decideApproval = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const container = await render(repository(decideApproval));

    await act(async () => button(container, "Reject Rental").click());

    expect(decideApproval).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Working…");
    expect(mocks.showToast).toHaveBeenCalledWith("A rejection reason is required.", "error");
  });

  it("exposes only approval decisions when the narrow capability is enabled without broad operational writes", async () => {
    const decideApproval = vi.fn(async () => ({ success: true as const, disposition: "ACCEPTED" as const, value: { rentalId: rental.id, status: "Draft" as const, approvalStatus: "Approved" as const, version: 5 } }));
    const container = await render(repository(decideApproval), false, true);

    expect(container.textContent).toContain("Approve Rental");
    expect(container.textContent).toContain("Reject Rental");
    expect(container.textContent).not.toContain("Reserve Rental");
    expect(container.textContent).not.toContain("Release Equipment");

    await act(async () => { button(container, "Approve Rental").click(); await Promise.resolve(); });
    expect(decideApproval).toHaveBeenCalledTimes(1);
  });

  it("hides approval actions when both the narrow and broad remote capabilities are disabled", async () => {
    const container = await render(repository(vi.fn()), false, false);
    expect(container.textContent).toBe("");
  });
});
