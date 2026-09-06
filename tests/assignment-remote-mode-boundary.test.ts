import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ permissions: new Set(["rental.create"]) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: (permission: string) => authState.permissions.has(permission) }) }));

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import { repositoryFailure, repositorySuccess } from "@/core/persistence";
import { getAssignmentRuntimeCapability } from "@/features/assignment/services/assignmentRuntimeCapability";
import { subscribeCanonicalAssignmentRefresh } from "@/features/assignment/remote/canonicalAssignmentRefresh";
import Assignments from "@/pages/Assignments";
import AssignmentDetails from "@/pages/Assignments/Details";
import NewAssignment from "@/pages/Assignments/New";
import EditAssignment from "@/pages/Assignments/Edit";

const roots: Root[] = [];
const page = (items: unknown[]) => repositorySuccess({ items, nextCursor: undefined });
const assignment = { id: "canonical-assignment", equipmentId: "canonical-equipment", operatorId: "canonical-operator", projectId: "canonical-project", assignedDate: "2026-08-23", expectedReturn: "2026-08-24", remarks: "Canonical", status: "Active" as const };

function remoteDependencies(input: { assignments?: unknown[]; failure?: boolean; writesEnabled?: boolean; assignmentCreateEnabled?: boolean; assignmentRepository?: boolean } = {}): ApplicationDependencies {
  const local = createLocalApplicationDependencies();
  const failure = repositoryFailure("REMOTE_FAILED", "failed", { context: {}, recoverability: "RETRYABLE", recommendedAction: "Retry" });
  const repository = (items: unknown[]) => ({ ...local.readRepositories.assignments, list: vi.fn(async () => input.failure ? failure : page(items)) });
  return {
    ...local,
    repositories: { ...local.repositories, assignment: { ...local.repositories.assignment, getAll: () => [{ ...assignment, id: "local-only-assignment" }] }, equipmentStatusRead: { ...local.repositories.equipmentStatusRead, list: vi.fn(async () => repositorySuccess([{ id: "equipment-status-available", status: "Available", description: "Available", active: true, deleted: false }])) } },
    readRepositories: {
      ...local.readRepositories,
      assignments: repository(input.assignments ?? []),
      equipment: repository([{ id: "canonical-equipment", assetNo: "ME-REMOTE", equipmentName: "Remote Equipment", statusId: "equipment-status-available", active: true }]),
      operators: repository([{ id: "canonical-operator", name: "Remote Operator", status: "Active" }]),
      projects: repository([{ id: "canonical-project", projectCode: "REMOTE", name: "Remote Project", status: "Active" }]),
    } as ApplicationDependencies["readRepositories"],
    commandRepositories: { ...local.commandRepositories, canonicalRental: { readReferenceData: vi.fn(async () => ({ success: true, value: { costCodes: [], activityCodes: [] } })) } as unknown as ApplicationDependencies["commandRepositories"]["canonicalRental"], ...((input.assignmentRepository ?? true) ? { canonicalAssignment: { createAssignment: vi.fn() } } : {}) },
    configuration: { ...local.configuration, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: input.writesEnabled ?? true, remoteAssignmentCreateEnabled: input.assignmentCreateEnabled ?? false },
  };
}

async function render(element: React.ReactNode, dependencies = remoteDependencies(), route = "/") {
  const container = document.createElement("div");
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(createElement(ApplicationDependencyProvider, { dependencies }, createElement(MemoryRouter, { initialEntries: [route] }, element))));
  return container;
}

afterEach(async () => { authState.permissions = new Set(["rental.create"]); while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("canonical Assignment remote UI boundary", () => {
  it("keeps remote list empty when only a local Assignment exists", async () => {
    const container = await render(createElement(Assignments));
    expect(container.textContent).toContain("No canonical Bookings found.");
    expect(container.textContent).not.toContain("local-only-assignment");
    expect(container.textContent).not.toContain("New Assignment");
  });

  it("renders canonical Assignment and deliberately adapted related records", async () => {
    const container = await render(createElement(Assignments), remoteDependencies({ assignments: [assignment] }));
    expect(container.textContent).toContain("ME-REMOTE");
    expect(container.textContent).toContain("Remote Equipment");
    expect(container.textContent).toContain("Remote Operator");
    expect(container.textContent).toContain("Remote Project");
    expect(container.querySelector('a[href="/assignments/canonical-assignment"]')).not.toBeNull();
  });

  it("keeps repository errors authoritative", async () => {
    const container = await render(createElement(Assignments), remoteDependencies({ failure: true }));
    expect(container.getAttribute("role") ?? container.querySelector('[role="alert"]')?.getAttribute("role")).toBe("alert");
    expect(container.textContent).toContain("Canonical Assignment data could not be loaded");
  });

  it("does not expose a local-only Assignment through remote details", async () => {
    const routes = createElement(Routes, null, createElement(Route, { path: "/assignments/:id", element: createElement(AssignmentDetails) }));
    const container = await render(routes, remoteDependencies(), "/assignments/local-only-assignment");
    expect(container.textContent).toBe("Assignment not found.");
  });

  it("offers Start Rental only from a canonical active Assignment", async () => {
    const routes = createElement(Routes, null, createElement(Route, { path: "/assignments/:id", element: createElement(AssignmentDetails) }));
    const container = await render(routes, remoteDependencies({ assignments: [assignment] }), "/assignments/canonical-assignment");
    expect(container.querySelector('a[href="/rentals/new?assignment=canonical-assignment"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Complete Assignment");
    expect(container.textContent).not.toContain("Cancel Assignment");
    expect(container.textContent).not.toContain("Edit Assignment");
  });

  it("fails closed on direct remote New and Edit routes", async () => {
    const newPage = await render(createElement(NewAssignment));
    expect(newPage.textContent).toContain("Assignment creation unavailable");
    const editPage = await render(createElement(EditAssignment));
    expect(editPage.textContent).toContain("Assignment editing unavailable");
  });

  it("enables canonical create only with permission, runtime flag, and repository", async () => {
    authState.permissions.add("assignment.create");
    const enabled = await render(createElement(NewAssignment));
    expect(enabled.textContent).toContain("Create a canonical remote Assignment.");
    const flagDisabled = await render(createElement(NewAssignment), remoteDependencies({ writesEnabled: false }));
    expect(flagDisabled.textContent).toContain("Assignment creation unavailable");
    const createOnly = await render(createElement(NewAssignment), remoteDependencies({ writesEnabled: false, assignmentCreateEnabled: true }));
    expect(createOnly.textContent).toContain("Create a canonical remote Assignment.");
    const repositoryMissing = await render(createElement(NewAssignment), remoteDependencies({ assignmentRepository: false }));
    expect(repositoryMissing.textContent).toContain("Assignment creation unavailable");
    authState.permissions.delete("assignment.create");
    const denied = await render(createElement(NewAssignment));
    expect(denied.textContent).toContain("Assignment creation unavailable");
  });

  it("submits canonical data, requests a canonical refresh, and navigates with the returned UUID", async () => {
    authState.permissions.add("assignment.create");
    const dependencies = remoteDependencies();
    const createdId = "11111111-1111-4111-8111-111111111111";
    const createAssignment = vi.fn(async () => ({ success: true as const, disposition: "ACCEPTED" as const, serverOccurredAt: "2026-08-23T00:00:00Z", refresh: [createdId], value: { ...assignment, id: createdId, companyId: "tenant", createdAt: "2026-08-23T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z", rowVersion: 1 } }));
    dependencies.commandRepositories.canonicalAssignment = { createAssignment };
    const refreshed = vi.fn();
    const unsubscribe = subscribeCanonicalAssignmentRefresh(refreshed);
    const routes = createElement(Routes, null,
      createElement(Route, { path: "/assignments/new", element: createElement(NewAssignment) }),
      createElement(Route, { path: "/assignments/:id", element: createElement("div", null, "Canonical destination") }),
    );
    const container = await render(routes, dependencies, "/assignments/new");
    await act(async () => { await Promise.resolve(); });
    for (const label of ["Equipment", "Operator", "Project"]) {
      const labelNode = [...container.querySelectorAll("label")].find((node) => node.textContent === label)!;
      const input = [...container.querySelectorAll("input")].find((node) => node.id === labelNode.htmlFor) as HTMLInputElement;
      await act(async () => input.click());
      const choice = container.querySelector('button[role="option"]') as HTMLButtonElement;
      await act(async () => choice.click());
    }
    await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit(); await Promise.resolve(); });
    expect(createAssignment).toHaveBeenCalledWith(expect.objectContaining({ equipmentId: "canonical-equipment", operatorId: "canonical-operator", projectId: "canonical-project" }));
    expect((createAssignment.mock.calls as unknown[][])[0][0]).toHaveProperty("expectedReturn", undefined);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Canonical destination");
    unsubscribe();
  });

  it("keeps Assigned Date required before invoking the canonical command", async () => {
    authState.permissions.add("assignment.create");
    const dependencies = remoteDependencies();
    const createAssignment = vi.fn();
    dependencies.commandRepositories.canonicalAssignment = { createAssignment };
    const container = await render(createElement(NewAssignment), dependencies, "/assignments/new");
    await act(async () => { await Promise.resolve(); });
    const assignedDate = [...container.querySelectorAll("input")].find((input) => input.type === "date" && input.required) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(assignedDate, "");
      assignedDate.dispatchEvent(new Event("change", { bubbles: true }));
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(createAssignment).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Complete the required Assignment fields and enter valid dates.");
  });

  it("keeps controlled canonical command failures on the form", async () => {
    authState.permissions.add("assignment.create");
    const dependencies = remoteDependencies();
    dependencies.commandRepositories.canonicalAssignment = { createAssignment: vi.fn(async () => ({ success: false as const, code: "EQUIPMENT_UNAVAILABLE" as const, message: "The selected Equipment is unavailable for Assignment.", retryable: false, refreshRequired: true })) };
    const container = await render(createElement(NewAssignment), dependencies, "/assignments/new");
    await act(async () => { await Promise.resolve(); });
    for (const label of ["Equipment", "Operator", "Project"]) {
      const labelNode = [...container.querySelectorAll("label")].find((node) => node.textContent === label)!;
      const input = [...container.querySelectorAll("input")].find((node) => node.id === labelNode.htmlFor) as HTMLInputElement;
      await act(async () => input.click());
      const choice = container.querySelector('button[role="option"]') as HTMLButtonElement;
      await act(async () => choice.click());
    }
    await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit(); await Promise.resolve(); });
    expect(container.textContent).toContain("The selected Equipment is unavailable for Assignment.");
  });

  it("preserves local read and mutation capability", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(getAssignmentRuntimeCapability(local)).toMatchObject({ legacyReads: true, legacyMutations: true, canonicalReads: false });
    expect(getAssignmentRuntimeCapability({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true }, true)).toMatchObject({ legacyReads: false, legacyMutations: false, canonicalReads: true, canonicalMutations: true });
    expect(getAssignmentRuntimeCapability({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteAssignmentCreateEnabled: true }, true)).toMatchObject({ canonicalMutations: false, canonicalCreation: true });
  });
});
