import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const contextState = vi.hoisted(() => ({ rentals: [], rentalEquipmentLines: [], assignments: [], equipment: [], operators: [], projects: [], customers: [] }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", displayName: "UAT Administrator", username: "admin" }, hasPermission: () => true }) }));
vi.mock("@/app/navigation/navigationConfig", () => ({
  getVisibleNavigation: () => [{ title: "OPERATIONS", items: [
    { label: "Bookings", path: "/assignments", icon: "assignments" },
    { label: "Rentals", path: "/rentals", icon: "rentals" },
  ] }],
}));
vi.mock("@/features/rental/context/RentalContext", () => ({ useRental: () => ({ rentals: contextState.rentals, rentalEquipmentLines: contextState.rentalEquipmentLines }) }));
vi.mock("@/features/assignment/context/AssignmentContext", () => ({ useAssignment: () => ({ assignments: contextState.assignments }) }));
vi.mock("@/features/equipment/context/EquipmentContext", () => ({ useEquipment: () => ({ equipment: contextState.equipment }) }));
vi.mock("@/features/operators/context/OperatorContext", () => ({ useOperator: () => ({ operators: contextState.operators }) }));
vi.mock("@/features/project/context/ProjectContext", () => ({ useProject: () => ({ projects: contextState.projects }) }));
vi.mock("@/features/customer/context/CustomerContext", () => ({ useCustomer: () => ({ customers: contextState.customers }) }));

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import Sidebar from "@/app/Sidebar";
import { repositorySuccess } from "@/core/persistence";
import type { CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import RemoteCommercialTermsPage from "@/features/rental/remote/RemoteCommercialTermsPage";
import type { AssignmentRecord } from "@/features/assignment/types";
import type { EquipmentRecord } from "@/features/equipment/types";
import type { RentalEquipmentLine } from "@/features/rental/equipment-line";
import type { RentalRecord } from "@/features/rental/types";
import type { WorkDescriptionRecord } from "@/features/masters/work-description";

const roots: Root[] = [];
const rental = { id: "rental-1", rentalNumber: "R-1", status: "Draft", rentalType: "Operated Rental", rowVersion: 1, dateOut: "2026-08-24" } as RentalRecord;
const line = { id: "line-1", rentalId: rental.id, equipmentId: "equipment-1", assignmentId: "assignment-1", status: "Draft" } as RentalEquipmentLine;
const equipment = { id: "equipment-1", assetNo: "EQ-1", equipmentName: "Equipment", costCodeId: "cost-1" } as EquipmentRecord;
const assignment = { id: "assignment-1", activityCodeId: "activity-1" } as AssignmentRecord;
const localWorkDescription: WorkDescriptionRecord = { id: "local-work", code: "UAT-WD-001", name: "UAT Equipment Rental Work", active: true, deleted: false, sortOrder: 0, operatorSelectable: true, requiresRemarks: false };

function dependencies(): { value: ApplicationDependencies; updateTerms: ReturnType<typeof vi.fn>; canonicalWorkList: ReturnType<typeof vi.fn> } {
  const local = createLocalApplicationDependencies();
  const page = <T,>(items: T[]) => repositorySuccess({ items, nextCursor: undefined });
  const updateTerms = vi.fn();
  const canonicalRental: CanonicalRentalRemoteRepository = {
    readWorkspace: vi.fn(async () => ({ success: true as const, value: { rentalId: rental.id, contracts: [], commercialSnapshots: [] } })),
    readReferenceData: vi.fn(async () => ({ success: true as const, value: { costCodes: [{ id: "cost-1", code: "COST", name: "Cost", active: true, sortOrder: 0 }], activityCodes: [{ id: "activity-1", code: "ACT", name: "Activity", active: true, sortOrder: 0 }] } })),
    getReleaseReadiness: vi.fn(),
    createDraft: vi.fn(), updateTerms, submitApproval: vi.fn(), decideApproval: vi.fn(), reserve: vi.fn(), release: vi.fn(), activate: vi.fn(),
  };
  const canonicalWorkList = vi.fn(async () => page([]));
  local.readRepositories.rentals.list = vi.fn(async () => page([rental]));
  local.readRepositories.rentalEquipmentLines.list = vi.fn(async () => page([line]));
  local.readRepositories.equipment.list = vi.fn(async () => page([equipment]));
  local.readRepositories.assignments.list = vi.fn(async () => page([assignment]));
  local.readRepositories.operators.list = vi.fn(async () => page([]));
  local.readRepositories.projects.list = vi.fn(async () => page([]));
  local.readRepositories.customers.list = vi.fn(async () => page([]));
  local.readRepositories.workDescriptions.list = canonicalWorkList;
  return { value: {
    ...local,
    configuration: { ...local.configuration, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: true },
    commandRepositories: { ...local.commandRepositories, canonicalRental },
  }, updateTerms, canonicalWorkList };
}

afterEach(async () => { localStorage.removeItem("equipment-rental-work-descriptions"); while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("Commercial Terms route isolation", () => {
  it("keeps sidebar SPA navigation active and does not leak local Work Descriptions", async () => {
    localStorage.setItem("equipment-rental-work-descriptions", JSON.stringify([localWorkDescription]));
    const deps = dependencies(), container = document.createElement("div"), root = createRoot(container); roots.push(root);
    const routes = createElement(Routes, null,
      createElement(Route, { path: "/rentals/:rentalId/commercial-terms", element: createElement(RemoteCommercialTermsPage, { rentalId: rental.id }) }),
      createElement(Route, { path: "/assignments", element: createElement("div", null, "Assignments destination") }),
      createElement(Route, { path: "/rentals", element: createElement("div", null, "Rentals destination") }),
    );
    await act(async () => { root.render(createElement(ApplicationDependencyProvider, { dependencies: deps.value }, createElement(MemoryRouter, { initialEntries: [`/rentals/${rental.id}/commercial-terms`] }, createElement(Fragment, null, createElement(Sidebar, { collapsed: false, mobileOpen: true, onToggle: vi.fn(), onNavigate: vi.fn() }), routes)))); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Commercial Terms / DEUR Preparation");
    expect(deps.canonicalWorkList).toHaveBeenCalled();
    expect(container.textContent).not.toContain(localWorkDescription.code);
    expect([...container.querySelectorAll("option")].map(option => option.textContent)).not.toContain(`${localWorkDescription.code} — ${localWorkDescription.name}`);
    expect(container.querySelector('main form')).toBeNull();
    expect(container.querySelector('main [class*="fixed"][class*="inset-0"]')).toBeNull();
    const assignments = [...container.querySelectorAll("a")].find(link => link.textContent === "Bookings");
    expect(assignments?.closest("form")).toBeNull();
    await act(async () => assignments?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Assignments destination");
    const rentals = [...container.querySelectorAll("a")].find(link => link.textContent === "Rentals");
    await act(async () => rentals?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Rentals destination");
    expect(deps.updateTerms).not.toHaveBeenCalled();
  });
});
