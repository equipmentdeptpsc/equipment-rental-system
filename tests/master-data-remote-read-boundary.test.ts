import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const local = vi.hoisted(() => ({
  equipment: [{ id: "local-equipment", assetNo: "ME-000001", equipmentName: "DT01", status: "Assigned" }],
  operators: [{ id: "local-operator", name: "Juan Pedro", status: "Active" }],
  projects: [{ id: "local-project", projectCode: "LOCAL", projectName: "Local Project", status: "Active" }],
  hasPermission: vi.fn(() => true),
  deleteEquipment: vi.fn(), deleteOperator: vi.fn(), addEquipment: vi.fn(), updateEquipment: vi.fn(), addOperator: vi.fn(), updateOperator: vi.fn(), addProject: vi.fn(), updateProject: vi.fn(),
}));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: local.hasPermission }) }));
vi.mock("@/features/equipment/context/EquipmentContext", () => ({ useEquipment: () => ({ equipment: local.equipment, getEquipment: (id: string) => local.equipment.find((item) => item.id === id), deleteEquipment: local.deleteEquipment, addEquipment: local.addEquipment, updateEquipment: local.updateEquipment }) }));
vi.mock("@/features/operators/context/OperatorContext", () => ({ useOperator: () => ({ operators: local.operators, deleteOperator: local.deleteOperator, addOperator: local.addOperator, updateOperator: local.updateOperator }) }));
vi.mock("@/features/project/context/ProjectContext", () => ({ useProject: () => ({ projects: local.projects, addProject: local.addProject, updateProject: local.updateProject }) }));

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import { repositoryFailure, repositorySuccess } from "@/core/persistence";
import { getEquipmentRuntimeCapability } from "@/features/equipment/services/equipmentRuntimeCapability";
import { getOperatorRuntimeCapability } from "@/features/operators/services/operatorRuntimeCapability";
import { requestCanonicalOperatorRefresh } from "@/features/operators/remote/canonicalOperatorRefresh";
import type { Operator } from "@/features/operators/types";
import { getProjectRuntimeCapability } from "@/features/project/services/projectRuntimeCapability";
import EquipmentPage from "@/pages/Equipment";
import EquipmentDetails from "@/pages/Equipment/Details";
import NewEquipment from "@/pages/Equipment/New";
import EditEquipment from "@/pages/Equipment/Edit";
import EquipmentTrash from "@/pages/Equipment/Trash";
import OperatorsPage from "@/pages/Operators";
import NewOperator from "@/pages/Operators/New";
import EditOperator from "@/pages/Operators/Edit";
import ProjectsPage from "@/pages/Projects";
import NewProject from "@/pages/Projects/New";
import EditProject from "@/pages/Projects/Edit";

const roots: Root[] = [];
const page = (items: unknown[]) => repositorySuccess({ items, nextCursor: undefined });
function remoteDependencies(input: { equipment?: unknown[]; operators?: unknown[]; projects?: unknown[]; failure?: "equipment" | "operators" | "projects" } = {}): ApplicationDependencies {
  const dependencies = createLocalApplicationDependencies();
  const failure = repositoryFailure("REMOTE_FAILED", "failed", { context: {}, recoverability: "RETRYABLE", recommendedAction: "Retry" });
  const repository = (name: "equipment" | "operators" | "projects", items: unknown[]) => ({
    ...dependencies.readRepositories[name],
    list: vi.fn(async () => input.failure === name ? failure : page(items)),
    getById: vi.fn(async (id: string) => {
      const item = items.find((candidate) => candidate && typeof candidate === "object" && "id" in candidate && candidate.id === id);
      return repositorySuccess(item ?? null);
    }),
  });
  return {
    ...dependencies,
    readRepositories: { ...dependencies.readRepositories, equipment: repository("equipment", input.equipment ?? []), operators: repository("operators", input.operators ?? []), projects: repository("projects", input.projects ?? []) } as ApplicationDependencies["readRepositories"],
    repositories: { ...dependencies.repositories, equipmentStatusRead: { ...dependencies.repositories.equipmentStatusRead, list: vi.fn(async () => repositorySuccess([{ id: "equipment-status-available", status: "Available", description: "Available", active: true, deleted: false }])) } },
    configuration: { ...dependencies.configuration, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true },
  };
}
async function render(element: React.ReactNode, dependencies = remoteDependencies(), route = "/") {
  const container = document.createElement("div"); const root = createRoot(container); roots.push(root);
  await act(async () => { root.render(createElement(ApplicationDependencyProvider, { dependencies }, createElement(MemoryRouter, { initialEntries: [route] }, element))); await Promise.resolve(); });
  return container;
}
afterEach(async () => { vi.clearAllMocks(); while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("remote canonical Equipment boundary", () => {
  it("ignores a local Equipment when the canonical response is empty", async () => {
    const container = await render(createElement(EquipmentPage));
    expect(container.textContent).toContain("No canonical Equipment found");
    expect(container.textContent).not.toContain("ME-000001");
    expect(container.textContent).not.toContain("Booked");
  });
  it("resolves canonical status labels without legacy translation", async () => {
    const row = { id: "canonical-equipment", assetNo: "REMOTE-1", equipmentName: "Remote Equipment", statusId: "equipment-status-available", active: true, deletedAt: null };
    const container = await render(createElement(EquipmentPage), remoteDependencies({ equipment: [row] }));
    expect(container.textContent).toContain("REMOTE-1"); expect(container.textContent).toContain("Available"); expect(container.textContent).not.toContain("Booked");
  });
  it("does not expose local details and fails closed on all mutation routes", async () => {
    const details = createElement(Routes, null, createElement(Route, { path: "/equipment/:id", element: createElement(EquipmentDetails) }));
    expect((await render(details, remoteDependencies(), "/equipment/local-equipment")).textContent).toContain("Equipment not found.");
    expect((await render(createElement(NewEquipment), remoteDependencies(), "/equipment/new")).textContent).toContain("Changes unavailable");
    expect((await render(createElement(EditEquipment), remoteDependencies(), "/equipment/edit/local-equipment")).textContent).toContain("No changes can be saved");
    expect((await render(createElement(EquipmentTrash), remoteDependencies(), "/equipment/trash")).textContent).toContain("Changes unavailable");
    expect(local.addEquipment).not.toHaveBeenCalled(); expect(local.updateEquipment).not.toHaveBeenCalled(); expect(local.deleteEquipment).not.toHaveBeenCalled();
  });
});

describe("remote canonical Operator boundary", () => {
  it("ignores a local Operator when the canonical response is empty", async () => {
    const container = await render(createElement(OperatorsPage));
    expect(container.textContent).toContain("No Operators match these filters"); expect(container.textContent).not.toContain("Juan Pedro");
  });
  it("fails closed before local create, edit, link, PIN, or delete behavior", async () => {
    expect((await render(createElement(NewOperator), remoteDependencies(), "/operators/new")).textContent).toContain("Changes unavailable");
    expect((await render(createElement(EditOperator), remoteDependencies(), "/operators/edit/local-operator")).textContent).toContain("certification assignments only");
    expect(local.addOperator).not.toHaveBeenCalled(); expect(local.updateOperator).not.toHaveBeenCalled(); expect(local.deleteOperator).not.toHaveBeenCalled();
  });
  it("re-reads the canonical list after a successful create refresh", async () => {
    const dependencies = remoteDependencies(); let items: Operator[] = [];
    dependencies.readRepositories.operators.list = vi.fn(async () => repositorySuccess({ items, nextCursor: undefined }));
    const container = await render(createElement(OperatorsPage), dependencies);
    expect(container.textContent).toContain("No Operators match these filters");
    items = [{ id: "canonical-operator", name: "New Canonical Operator", email: "", licenseNumber: "", status: "Active", certificationType: "None", joinedDate: "2026-08-23" }];
    await act(async () => { requestCanonicalOperatorRefresh(); await Promise.resolve(); });
    expect(container.textContent).toContain("New Canonical Operator"); expect(container.textContent).toContain("Active"); expect(container.textContent).not.toContain("Juan Pedro");
  });
});

describe("remote canonical Project boundary", () => {
  it("ignores a local Project when the canonical response is empty", async () => {
    const container = await render(createElement(ProjectsPage));
    expect(container.textContent).toContain("No canonical Projects found."); expect(container.textContent).not.toContain("Local Project");
  });
  it("fails closed before local create or edit behavior", async () => {
    expect((await render(createElement(NewProject), remoteDependencies(), "/projects/new")).textContent).toContain("Changes unavailable");
    expect((await render(createElement(EditProject), remoteDependencies(), "/projects/local-project/edit")).textContent).toContain("Project not found");
    expect(local.addProject).not.toHaveBeenCalled(); expect(local.updateProject).not.toHaveBeenCalled();
  });
});

describe("master-data runtime capabilities", () => {
  it("preserves local reads/mutations and makes remote reads canonical-only", () => {
    const localConfiguration = createLocalApplicationDependencies().configuration;
    for (const capability of [getEquipmentRuntimeCapability, getOperatorRuntimeCapability, getProjectRuntimeCapability]) {
      expect(capability(localConfiguration)).toMatchObject({ canonicalReads: false, legacyReads: true, legacyMutations: true });
      expect(capability({ ...localConfiguration, persistenceMode: PersistenceMode.Remote })).toMatchObject({ canonicalReads: true, legacyReads: false, legacyMutations: false });
    }
  });
});
