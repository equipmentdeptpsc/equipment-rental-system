import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ permissions: new Set(["equipment.create"]), localAdd: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: (permission: string) => state.permissions.has(permission) }) }));
vi.mock("@/features/equipment/context/EquipmentContext", () => ({ useEquipment: () => ({ equipment: [], addEquipment: state.localAdd }) }));
vi.mock("@/features/equipment/audit/AuditContext", () => ({ useAudit: () => ({ logAction: vi.fn() }) }));

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import { subscribeCanonicalEquipmentRefresh } from "@/features/equipment/remote/canonicalEquipmentRefresh";
import { SupabaseEquipmentCommandRepository } from "@/integrations/supabase/SupabaseEquipmentCommandRepository";
import NewEquipment from "@/pages/Equipment/New";

const roots: Root[] = [];
function remoteDependencies(input: { enabled?: boolean; equipmentCreateEnabled?: boolean; repository?: boolean } = {}) {
  const dependencies = createLocalApplicationDependencies();
  const readReferenceData = vi.fn(async () => ({ success: true as const, costCodes: [{ id: "cost-1", code: "EQP", name: "Equipment", active: true as const, sortOrder: 1 }] }));
  const createEquipment = vi.fn(async (_command: unknown) => ({ success: true as const, disposition: "ACCEPTED" as const, serverOccurredAt: "2026-08-23T00:00:00Z", refresh: [], value: { id: "equipment-1", companyId: "tenant", assetNo: "EQ-001", equipmentName: "Excavator", maintenanceType: "Engine Hours" as const, costCodeId: "cost-1", statusId: "available", currentReading: 0, remarks: null, active: true as const, deletedAt: null, createdAt: "2026-08-23T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z", rowVersion: 1 } }));
  const equipmentCategories = { getById: vi.fn(), list: vi.fn(async () => ({ success: true as const, value: { items: [{ id: "category-1", name: "Earthmoving", active: true, deletedAt: null, sortOrder: 1 }] } })), search: vi.fn() };
  const equipmentSubcategories = { getById: vi.fn(), list: vi.fn(), search: vi.fn(), listAssignable: vi.fn(async (categoryId: string) => ({ success: true as const, value: categoryId === "category-1" ? [{ id: "subcategory-1", categoryId, name: "Excavators", active: true, usageCount: 0, updatedAt: "2026-09-05T00:00:00Z", rowVersion: 1 }] : [] })) };
  return { dependencies: { ...dependencies, readRepositories: { ...dependencies.readRepositories, equipmentCategories, equipmentSubcategories }, commandRepositories: { ...dependencies.commandRepositories, ...(input.repository === false ? {} : { canonicalEquipment: { readReferenceData, createEquipment } }) }, configuration: { ...dependencies.configuration, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: input.enabled ?? true, remoteEquipmentCreateEnabled: input.equipmentCreateEnabled ?? false } } as ApplicationDependencies, readReferenceData, createEquipment };
}
async function render(dependencies: ApplicationDependencies) { const container = document.createElement("div"); const root = createRoot(container); roots.push(root); const routes = createElement(Routes, null, createElement(Route, { path: "/equipment/new", element: createElement(NewEquipment) }), createElement(Route, { path: "/equipment", element: createElement("div", null, "Canonical Equipment destination") })); await act(async () => { root.render(createElement(ApplicationDependencyProvider, { dependencies }, createElement(MemoryRouter, { initialEntries: ["/equipment/new"] }, routes))); await Promise.resolve(); }); return container; }
function input(container: HTMLElement, label: string) { const node = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim().startsWith(label)); return container.querySelector(`[id="${node!.htmlFor}"]`) as HTMLInputElement; }
function setInput(node: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }
function select(container: HTMLElement, label: string) { return container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement; }
function setSelect(node: HTMLSelectElement, value: string) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("change", { bubbles: true })); }
async function completeRequiredRemoteFields(container: HTMLElement) { await act(async () => { setInput(input(container, "Asset Number"), "EQ-001"); setInput(input(container, "Equipment Name"), "Excavator"); setSelect(select(container, "Equipment Category"), "category-1"); await Promise.resolve(); }); await act(async () => { await Promise.resolve(); setSelect(select(container, "Equipment Sub-Category"), "subcategory-1"); setSelect([...container.querySelectorAll("select")].find((node) => node.parentElement?.textContent?.startsWith("Cost Code")) as HTMLSelectElement, "cost-1"); }); }
afterEach(async () => { state.permissions = new Set(["equipment.create"]); vi.clearAllMocks(); while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("canonical Equipment remote create boundary", () => {
  it("has no Rental reference or local Cost Code dependency", () => {
    const source = `${readFileSync("src/features/equipment/components/RemoteEquipmentForm.tsx", "utf8")}\n${readFileSync("src/integrations/supabase/SupabaseEquipmentCommandRepository.ts", "utf8")}`;
    expect(source).not.toMatch(/canonicalRental|read_canonical_rental_reference_data|costCodeRepository|useCostCodes/);
  });
  it("parses the live reference shape without an operational command envelope", async () => {
    const rpc = vi.fn(async () => ({ data: { success: true, costCodes: [] }, error: null }));
    const repository = new SupabaseEquipmentCommandRepository({ schema: () => ({ rpc }) });
    await expect(repository.readReferenceData()).resolves.toEqual({ success: true, costCodes: [] });
    expect(rpc).toHaveBeenCalledWith("read_canonical_equipment_reference_data");
  });
  it("validates non-empty reference rows and rejects malformed payloads", async () => {
    const valid = { success: true, costCodes: [{ id: "cost-1", code: "EQP", name: "Equipment", active: true, sortOrder: 1 }] };
    const rpc = vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: valid, error: null }));
    const repository = new SupabaseEquipmentCommandRepository({ schema: () => ({ rpc }) });
    await expect(repository.readReferenceData()).resolves.toEqual(valid);
    for (const malformed of [null, [], {}, { success: "true", costCodes: [] }, { success: true }, { success: true, costCodes: null }, { success: true, costCodes: [{ id: "cost-1", code: "EQP", name: "Equipment", active: true, sort_order: 1 }] }]) {
      rpc.mockResolvedValueOnce({ data: malformed, error: null });
      await expect(repository.readReferenceData()).resolves.toMatchObject({ success: false, code: "INVALID_RESPONSE", message: "The remote Equipment reference response was invalid." });
    }
  });
  it("keeps Supabase transport failures distinct from invalid payloads", async () => {
    const repository = new SupabaseEquipmentCommandRepository({ schema: () => ({ rpc: vi.fn(async () => ({ data: null, error: { message: "PGRST failure" } })) }) });
    await expect(repository.readReferenceData()).resolves.toEqual({ success: false, code: "TRANSPORT_FAILURE", message: "Equipment reference data could not be loaded.", retryable: true });
  });
  it("fails closed without flag, repository, or permission", async () => { expect((await render(remoteDependencies({ enabled: false }).dependencies)).textContent).toContain("Equipment changes are unavailable"); expect((await render(remoteDependencies({ repository: false }).dependencies)).textContent).toContain("Equipment changes are unavailable"); state.permissions.clear(); expect((await render(remoteDependencies().dependencies)).textContent).toContain("Equipment changes are unavailable"); });
  it("exposes create with the dedicated flag while broad writes remain disabled", async () => { const container = await render(remoteDependencies({ enabled: false, equipmentCreateEnabled: true }).dependencies); expect(container.textContent).toContain("Create canonical remote Equipment."); expect(container.textContent).not.toContain("Equipment changes are unavailable"); });
  it("keeps Equipment update and delete outside the narrow capability", () => { const source = readFileSync("src/features/equipment/services/equipmentRuntimeCapability.ts", "utf8"); expect(source).not.toMatch(/update|delete|deactivate/i); });
  it("uses Equipment-owned Cost Codes and submits only approved fields", async () => {
    const { dependencies, readReferenceData, createEquipment } = remoteDependencies(); const refreshed = vi.fn(); const unsubscribe = subscribeCanonicalEquipmentRefresh(refreshed); const container = await render(dependencies);
    expect(readReferenceData).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("EQP — Equipment");
    for (const unsupported of ["Status", "Project", "Operator", "Customer", "Category", "Type", "Brand", "Location", "Ownership", "Prefix", "Rate", "PIN", "Password"]) expect([...container.querySelectorAll("label")].some((label) => label.textContent?.trim().startsWith(unsupported))).toBe(false);
    await completeRequiredRemoteFields(container);
    await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit(); await Promise.resolve(); });
    expect(createEquipment).toHaveBeenCalledWith(expect.objectContaining({ assetNo: "EQ-001", equipmentName: "Excavator", categoryId: "category-1", subcategoryId: "subcategory-1", maintenanceType: "Engine Hours", costCodeId: "cost-1" }));
    for (const field of ["companyId", "statusId", "active", "projectId", "operatorId", "createdBy", "rowVersion", "legacyPayload"]) expect(createEquipment.mock.calls[0][0]).not.toHaveProperty(field);
    expect(state.localAdd).not.toHaveBeenCalled(); expect(refreshed).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("Canonical Equipment destination"); unsubscribe();
  });
  it("treats a canonical replay as success", async () => { const { dependencies } = remoteDependencies(); dependencies.commandRepositories.canonicalEquipment!.createEquipment = vi.fn(async () => ({ success: true as const, disposition: "REPLAYED" as const, serverOccurredAt: "2026-08-23T00:00:00Z", refresh: [], value: { id: "equipment-1", companyId: "tenant", assetNo: "EQ-001", equipmentName: "Excavator", maintenanceType: "Engine Hours" as const, costCodeId: "cost-1", statusId: "available", currentReading: 0, remarks: null, active: true as const, deletedAt: null, createdAt: "2026-08-23T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z", rowVersion: 1 } })); const container = await render(dependencies); await completeRequiredRemoteFields(container); await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit(); await Promise.resolve(); }); expect(container.textContent).toContain("Canonical Equipment destination"); });
  it("shows a controlled duplicate Asset Number response without local fallback", async () => { const { dependencies } = remoteDependencies(); dependencies.commandRepositories.canonicalEquipment!.createEquipment = vi.fn(async () => ({ success: false as const, code: "ASSET_NUMBER_CONFLICT" as const, message: "Asset number already exists.", retryable: false, refreshRequired: true })); const container = await render(dependencies); await completeRequiredRemoteFields(container); await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit(); await Promise.resolve(); }); expect(container.textContent).toContain("Asset number already exists."); expect(state.localAdd).not.toHaveBeenCalled(); });
  it("renders loaded-empty as a controlled prerequisite state and cannot submit", async () => { const { dependencies, createEquipment } = remoteDependencies(); dependencies.commandRepositories.canonicalEquipment!.readReferenceData = vi.fn(async () => ({ success: true as const, costCodes: [] })); const container = await render(dependencies); expect(container.textContent).toContain("No active Cost Codes are available"); expect(container.textContent).not.toContain("The remote Equipment reference response was invalid."); expect(container.querySelector("form")).toBeNull(); expect(createEquipment).not.toHaveBeenCalled(); expect(state.localAdd).not.toHaveBeenCalled(); });
  it("keeps a canonical repository error authoritative", async () => { const { dependencies } = remoteDependencies(); dependencies.commandRepositories.canonicalEquipment!.readReferenceData = vi.fn(async () => ({ success: false as const, code: "INVALID_RESPONSE" as const, message: "The remote Equipment reference response was invalid.", retryable: false })); const container = await render(dependencies); expect(container.textContent).toContain("The remote Equipment reference response was invalid."); expect(state.localAdd).not.toHaveBeenCalled(); });
});
