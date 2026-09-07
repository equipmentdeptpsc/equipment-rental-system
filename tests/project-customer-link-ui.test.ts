import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ permissions: new Set<string>(["project.update"]) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: (permission: string) => auth.permissions.has(permission) }) }));

import { ApplicationDependencyProvider, createLocalApplicationDependencies, PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import { repositorySuccess } from "@/core/persistence";
import type { CustomerRecord } from "@/features/customer/types";
import type { ProjectRecord } from "@/features/project/types";
import type { ProjectCommandRepository } from "@/features/project/commands/contracts";
import RemoteProjectCustomerLink from "@/features/project/components/RemoteProjectCustomerLink";

const projectId = "cbe724c2-cd45-4763-b7a2-62acdd8e7e2b";
const customerId = "fd753935-f65c-456b-ad54-55265dc3223d";
const customer: CustomerRecord = { id: customerId, customerCode: "UAT-CUS-001", companyName: "UAT Equipment Rental Customer", active: true };
const unlinkedProject: ProjectRecord = { id: projectId, projectCode: "UAT-PROJ-002", projectName: "UAT Customer Rental Project", location: "", projectManager: "", status: "Active", rowVersion: 1 };
const roots: Root[] = [];

function dependencies(input: {
  enabled?: boolean;
  project?: ProjectRecord;
  update?: NonNullable<ProjectCommandRepository["updateProjectCustomer"]>;
} = {}) {
  const base = createLocalApplicationDependencies();
  let project = input.project ?? unlinkedProject;
  const getProject = vi.fn(async () => repositorySuccess(project));
  const listCustomers = vi.fn(async () => repositorySuccess({ items: [customer], nextCursor: undefined }));
  const getCustomer = vi.fn(async () => repositorySuccess(customer));
  const listAssignments = vi.fn(base.readRepositories.assignments.list);
  const listRentals = vi.fn(base.readRepositories.rentals.list);
  const updateProjectCustomer = input.update ?? vi.fn(async () => {
    project = { ...project, customerId, rowVersion: 2 };
    return { success: true as const, disposition: "ACCEPTED" as const, serverOccurredAt: "2026-09-07T00:00:00Z", refresh: [projectId], value: { id: projectId, companyId: "tenant", customerId, rowVersion: 2 } };
  });
  const value: ApplicationDependencies = {
    ...base,
    readRepositories: {
      ...base.readRepositories,
      projects: { ...base.readRepositories.projects, getById: getProject },
      customers: { ...base.readRepositories.customers, list: listCustomers, getById: getCustomer },
      assignments: { ...base.readRepositories.assignments, list: listAssignments },
      rentals: { ...base.readRepositories.rentals, list: listRentals },
    },
    commandRepositories: {
      ...base.commandRepositories,
      canonicalProject: { createProject: vi.fn(), updateProjectCustomer },
    },
    configuration: {
      ...base.configuration,
      persistenceMode: PersistenceMode.Remote,
      remoteOperationalWritesEnabled: false,
      remoteProjectCustomerLinkEnabled: input.enabled ?? true,
    },
  };
  return { value, getProject, listCustomers, getCustomer, listAssignments, listRentals, updateProjectCustomer };
}

async function render(value: ApplicationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(ApplicationDependencyProvider, { dependencies: value },
      createElement(MemoryRouter, { initialEntries: [`/projects/${projectId}/customer`] },
        createElement(Routes, null, createElement(Route, { path: "/projects/:id/customer", element: createElement(RemoteProjectCustomerLink) })))));
    await Promise.resolve();
  });
  return container;
}

async function selectCustomer(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => input.click());
  const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes(customer.customerCode))!;
  await act(async () => option.click());
}

function linkButton(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Link Customer"));
}

afterEach(async () => {
  auth.permissions = new Set(["project.update"]);
  vi.restoreAllMocks();
  while (roots.length) await act(async () => roots.pop()?.unmount());
});

describe("canonical Project Customer-link UI", () => {
  it("keeps the UI on the typed canonical repository boundary without local or direct-table writes", () => {
    const source = readFileSync("src/features/project/components/RemoteProjectCustomerLink.tsx", "utf8");
    expect(source).toContain("repository.updateProjectCustomer");
    expect(source).toContain("paging: { limit: 100, offset: 0 }");
    expect(source).not.toContain("localStorage");
    expect(source).not.toMatch(/\.from\(["']projects["']\)/);
    expect(source).not.toMatch(/(assignment|rental).*\.(create|update|delete)\(/i);
  });

  it("selects a bounded active Customer, invokes the command once with exact IDs, refetches, and displays the canonical link", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setup = dependencies();
    const container = await render(setup.value);
    await selectCustomer(container);
    await act(async () => { container.querySelector<HTMLFormElement>("form")!.requestSubmit(); await Promise.resolve(); await Promise.resolve(); });

    expect(setup.listCustomers).toHaveBeenCalledWith({ filters: { active: true, deleted_at: null }, ordering: [{ field: "customer_code", ascending: true }], paging: { limit: 100, offset: 0 } });
    expect(setup.updateProjectCustomer).toHaveBeenCalledTimes(1);
    expect(setup.updateProjectCustomer).toHaveBeenCalledWith(expect.objectContaining({ projectId, customerId, expectedVersion: 1 }));
    expect(setup.getProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("UAT Equipment Rental Customer");
    expect(linkButton(container)).toBeUndefined();
    expect(setup.listAssignments).not.toHaveBeenCalled();
    expect(setup.listRentals).not.toHaveBeenCalled();
  });

  it("keeps the mutation control unavailable when the dedicated capability is false", async () => {
    const setup = dependencies({ enabled: false });
    const container = await render(setup.value);
    expect(container.textContent).toContain("UAT Customer Rental Project");
    expect(linkButton(container)).toBeUndefined();
    expect(setup.listCustomers).not.toHaveBeenCalled();
  });

  it("keeps the mutation control unavailable without project.update", async () => {
    auth.permissions.clear();
    const setup = dependencies();
    const container = await render(setup.value);
    expect(container.textContent).toContain("Not linked");
    expect(linkButton(container)).toBeUndefined();
    expect(setup.listCustomers).not.toHaveBeenCalled();
  });

  it("renders an existing canonical Customer read-only and does not expose relinking", async () => {
    const setup = dependencies({ project: { ...unlinkedProject, customerId } });
    const container = await render(setup.value);
    expect(container.textContent).toContain("UAT-CUS-001 — UAT Equipment Rental Customer");
    expect(setup.getCustomer).toHaveBeenCalledWith(customerId);
    expect(linkButton(container)).toBeUndefined();
    expect(setup.listCustomers).not.toHaveBeenCalled();
  });

  it("surfaces a canonical rejection and remains unlinked", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const update = vi.fn(async () => ({ success: false as const, code: "CUSTOMER_RELINK_NOT_ALLOWED" as const, message: "This Project is already linked to a different Customer.", retryable: false, refreshRequired: false }));
    const setup = dependencies({ update });
    const container = await render(setup.value);
    await selectCustomer(container);
    await act(async () => { container.querySelector<HTMLFormElement>("form")!.requestSubmit(); await Promise.resolve(); });
    expect(container.textContent).toContain("already linked to a different Customer");
    expect(container.textContent).toContain("Not linked");
    expect(linkButton(container)).toBeDefined();
    expect(setup.getProject).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate command invocation while a link is in progress", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolve!: (value: { success: true; disposition: "ACCEPTED"; serverOccurredAt: string; refresh: string[]; value: { id: string; companyId: string; customerId: string; rowVersion: number } }) => void;
    const pending = new Promise<Parameters<typeof resolve>[0]>((done) => { resolve = done; });
    const update = vi.fn(() => pending);
    const setup = dependencies({ update });
    const container = await render(setup.value);
    await selectCustomer(container);
    const form = container.querySelector<HTMLFormElement>("form")!;
    await act(async () => { form.requestSubmit(); form.requestSubmit(); await Promise.resolve(); });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ success: true, disposition: "ACCEPTED", serverOccurredAt: "2026-09-07T00:00:00Z", refresh: [projectId], value: { id: projectId, companyId: "tenant", customerId, rowVersion: 2 } }); await pending; });
  });
});
