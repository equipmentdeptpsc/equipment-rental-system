import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import { repositoryFailure, repositorySuccess } from "@/core/persistence";
import { useRentalListData, type RentalListData } from "@/features/rental/hooks/useRentalListData";
import type { CanonicalRentalReferenceData, CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import { canUseAnyRentalMutations, canUseCanonicalRemoteRentalCreation, canUseCanonicalRemoteRentalMutations, canUseLegacyRentalMutations } from "@/features/rental/services/rentalRuntimeCapability";

const empty: RentalListData = { rentals: [], rentalEquipmentLines: [], equipment: [], assignments: [], operators: [], projects: [], customers: [], costCodes: [], activityCodes: [] };
const fallback: RentalListData = { ...empty, rentals: [{ id: "local-rental", status: "Draft" } as RentalListData["rentals"][number]] };
const roots: Root[] = [];

function dependencies(list: ReturnType<typeof vi.fn>, references: CanonicalRentalReferenceData = { costCodes: [], activityCodes: [] }): ApplicationDependencies {
  const local = createLocalApplicationDependencies();
  const repository = { ...local.readRepositories.rentals, list };
  const unusedCanonicalFailure = { success: false as const, code: "VALIDATION_REJECTED" as const, message: "Unused test repository method." };
  const canonicalRental: CanonicalRentalRemoteRepository = {
    readWorkspace: vi.fn(async () => unusedCanonicalFailure),
    readReferenceData: vi.fn(async () => ({ success: true as const, value: references })),
    createDraft: vi.fn(async () => unusedCanonicalFailure),
    updateTerms: vi.fn(async () => unusedCanonicalFailure),
    submitApproval: vi.fn(async () => unusedCanonicalFailure),
    decideApproval: vi.fn(async () => unusedCanonicalFailure),
    reserve: vi.fn(async () => unusedCanonicalFailure),
    release: vi.fn(async () => unusedCanonicalFailure),
    activate: vi.fn(async () => unusedCanonicalFailure),
  };
  return {
    ...local,
    readRepositories: {
      ...local.readRepositories,
      users: repository, rentals: repository, rentalEquipmentLines: repository,
      equipment: repository, assignments: repository, operators: repository,
      customers: repository, projects: repository, billing: repository, deurs: repository,
      workDescriptions: repository,
    } as ApplicationDependencies["readRepositories"],
    configuration: { ...local.configuration, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true },
    commandRepositories: { ...local.commandRepositories, canonicalRental },
  };
}

function renderHook(deps: ApplicationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container); roots.push(root);
  function Probe() {
    const state = useRentalListData(fallback);
    return createElement("button", { onClick: state.retry }, `${state.status}:${state.data.rentals.map((item) => item.id).join(",")}:${"message" in state ? state.message : ""}`);
  }
  return { container, root, element: createElement(ApplicationDependencyProvider, { dependencies: deps }, createElement(Probe)) };
}

afterEach(async () => { while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("Rental remote-mode boundary", () => {
  it("allows legacy Rental mutations only in local persistence mode", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(canUseLegacyRentalMutations(local)).toBe(true);
    expect(canUseLegacyRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseLegacyRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true })).toBe(false);
    expect(canUseCanonicalRemoteRentalMutations(local)).toBe(false);
    expect(canUseCanonicalRemoteRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalCreation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalCreation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalCreateEnabled: true })).toBe(true);
    expect(canUseAnyRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true }, true)).toBe(true);
    expect(canUseAnyRentalMutations({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true }, false)).toBe(false);
  });

  it("never exposes local fallback while canonical remote Rental data is loading or fails", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    const list = vi.fn(() => pending);
    const rendered = renderHook(dependencies(list));
    await act(async () => rendered.root.render(rendered.element));
    expect(rendered.container.textContent).toBe("loading::");
    await act(async () => resolve(repositoryFailure("REMOTE_FAILED", "failed", { context: {}, recoverability: "RETRYABLE", recommendedAction: "Retry" }) as never));
    expect(rendered.container.textContent).toContain("error::Canonical Rental data could not be loaded");
    expect(rendered.container.textContent).not.toContain("local-rental");
  });

  it("continues to expose the local dataset in local persistence mode", async () => {
    const rendered = renderHook(createLocalApplicationDependencies());
    await act(async () => rendered.root.render(rendered.element));
    expect(rendered.container.textContent).toBe("loaded:local-rental:");
  });

  it("loads the canonical remote dataset and retries an explicit error", async () => {
    const success = repositorySuccess({ items: [], nextCursor: undefined });
    const failure = repositoryFailure("REMOTE_FAILED", "failed", { context: {}, recoverability: "RETRYABLE", recommendedAction: "Retry" });
    const list = vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(success);
    const rendered = renderHook(dependencies(list));
    await act(async () => rendered.root.render(rendered.element));
    expect(rendered.container.textContent).toContain("error:");
    await act(async () => rendered.container.querySelector("button")?.click());
    expect(rendered.container.textContent).toBe("loaded::");
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it("loads canonical operational references without exposing local master data", async () => {
    const success = repositorySuccess({ items: [], nextCursor: undefined });
    const refs = { costCodes: [{ id: "cost-id", code: "UAT-CC-001", name: "Cost", active: true, sortOrder: 0 }], activityCodes: [{ id: "activity-id", code: "UAT-ACT-001", name: "Activity", active: true, sortOrder: 0 }] };
    const deps = dependencies(vi.fn().mockResolvedValue(success), refs);
    const container=document.createElement("div"),root=createRoot(container);roots.push(root);
    function Probe(){const state=useRentalListData(fallback);return createElement("div",null,`${state.status}:${state.data.costCodes[0]?.id??""}:${state.data.activityCodes[0]?.id??""}`)}
    await act(async()=>root.render(createElement(ApplicationDependencyProvider,{dependencies:deps},createElement(Probe))));
    expect(container.textContent).toBe("loaded:cost-id:activity-id");
  });
});
