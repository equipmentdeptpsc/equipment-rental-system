import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/form/useFormSubmission", () => ({
  useFormSubmission: (_entity: string, onSubmit: (data: unknown) => void) => ({
    busy: false,
    feedback: null,
    fail: vi.fn(),
    submit: (data: unknown) => onSubmit(data),
  }),
}));
vi.mock("@/components/ui/Input", () => ({ default: ({ label, ...props }: { label: string } & Record<string, unknown>) => createElement("label", {}, label, createElement("input", props)) }));
vi.mock("@/components/ui/Select", () => ({ default: ({ label, options = [], ...props }: { label: string; options?: Array<{ value: string; label: string }> } & Record<string, unknown>) => createElement("label", {}, label, createElement("select", props, options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))) ) }));
vi.mock("@/components/ui/Button", () => ({ default: ({ children, ...props }: { children?: unknown } & Record<string, unknown>) => createElement("button", props, String(children ?? "")) }));
vi.mock("@/features/rental/components/RentalOperationalMetadataCard", () => ({ default: () => null }));
vi.mock("@/features/equipment/context/EquipmentContext", () => ({ useEquipment: () => ({ equipment: [] }) }));
vi.mock("@/features/customer/context/CustomerContext", () => ({ useCustomer: () => ({ customers: [] }) }));
vi.mock("@/features/project/context/ProjectContext", () => ({ useProject: () => ({ projects: [] }) }));
vi.mock("@/features/operators/context/OperatorContext", () => ({ useOperator: () => ({ operators: [] }) }));
vi.mock("@/features/assignment/context/AssignmentContext", () => ({ useAssignment: () => ({ assignments: [] }) }));
vi.mock("@/features/masters/cost-code/context/useCostCodes", () => ({ useCostCodes: () => ({ costCodes: [] }) }));
vi.mock("@/features/masters/activity-code", () => ({ useActivityCodes: () => ({ records: [] }) }));
vi.mock("@/features/rental/services/selectableRentalEquipment", () => ({ selectableRentalEquipment: () => [] }));
vi.mock("@/features/rental/utils/rentalFormOptions", () => ({ getRentalEquipmentLabel: () => "", getRentalProjectOptions: () => [] }));
vi.mock("@/features/rental/utils/rentalDateValidation", () => ({ localCalendarDate: () => "2026-09-08", validateNewRentalDates: () => undefined }));
vi.mock("@/features/rental/deur/shift-window/repository", () => ({ deurShiftWindowRepository: { getAll: () => [] } }));
vi.mock("@/features/rental/services/createRentalOperationalMetadataSnapshot", () => ({ createRentalOperationalMetadataSnapshot: () => undefined }));

import RentalForm from "@/features/rental/components/RentalForm";

const customer = { id: "customer-1", customerCode: "CUS-1", companyName: "UAT Customer", email: "", contactPerson: "", active: true };

describe("RentalForm review email", () => {
  let root: Root | undefined;
  afterEach(() => root?.unmount());

  it("retains a typed email across customer-data refresh and submits it", async () => {
    const submitted: unknown[] = [];
    const container = document.createElement("div");
    root = createRoot(container);
    const props = { onSubmit: (data: unknown): void => { submitted.push(data); }, initialCustomerId: customer.id, initialProjectId: "project-1", canonicalData: { equipment: [{ id: "equipment-1", active: true, deleted: false }] as never, customers: [customer], projects: [{ id: "project-1", customerId: customer.id, projectCode: "P-1", projectName: "Project", status: "Active" }] as never, operators: [{ id: "operator-1", name: "Operator", status: "Active" }] as never, assignments: [{ id: "assignment-1", equipmentId: "equipment-1", operatorId: "operator-1", projectId: "project-1", status: "Active" }] as never, costCodes: [], activityCodes: [] } };
    await act(async () => root?.render(createElement(RentalForm, props)));
    const email = [...container.querySelectorAll("input")].find((input) => input.type === "email") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "uat.d3e@example.test"); email.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(email.value).toBe("uat.d3e@example.test");

    await act(async () => root?.render(createElement(RentalForm, { ...props, canonicalData: { ...props.canonicalData, customers: [{ ...customer }] } })));
    const refreshedEmail = [...container.querySelectorAll("input")].find((input) => input.type === "email") as HTMLInputElement;
    expect(refreshedEmail.value).toBe("uat.d3e@example.test");
    await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(submitted).toHaveLength(1);
    expect((submitted[0] as { customerReviewEmail?: string }).customerReviewEmail).toBe("uat.d3e@example.test");
  });
  it("keeps an active canonical Assignment selectable when its Equipment has no legacy status label", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(RentalForm, {
      onSubmit: (): void => undefined,
      initialCustomerId: customer.id,
      initialProjectId: "project-1",
      canonicalData: {
        equipment: [{ id: "equipment-1", active: true, deleted: false, status: undefined }] as never,
        customers: [customer],
        projects: [{ id: "project-1", customerId: customer.id, projectCode: "P-1", projectName: "Project", status: "Active" }] as never,
        operators: [{ id: "operator-1", name: "Operator", status: "Active" }] as never,
        assignments: [{ id: "assignment-1", equipmentId: "equipment-1", operatorId: "operator-1", projectId: "project-1", status: "Active" }] as never,
        costCodes: [], activityCodes: [],
      },
    })));
    const assignment = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(assignment.disabled).toBe(false);
  });

  it("hides direct Equipment selection and rejects canonical Rental submit without an Assignment", async () => {
    const submitted: unknown[] = [];
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(RentalForm, { onSubmit: (data: unknown): void => { submitted.push(data); }, canonicalData: { equipment: [{ id: "equipment-1", active: true, deleted: false }] as never, customers: [customer], projects: [{ id: "project-1", customerId: customer.id, projectCode: "P-1", projectName: "Project", status: "Active" }] as never, operators: [], assignments: [], costCodes: [], activityCodes: [] }, initialCustomerId: customer.id, initialProjectId: "project-1" })));
    expect([...container.querySelectorAll("label")].some((label) => label.textContent?.trim() === "Equipment")).toBe(false);
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(submitted).toHaveLength(0);
  });

  it("submits canonical Rental data only with Assignment-backed lines", async () => {
    const submitted: unknown[] = [];
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(RentalForm, { onSubmit: (data: unknown): void => { submitted.push(data); }, canonicalData: { equipment: [{ id: "equipment-1", active: true, deleted: false }] as never, customers: [customer], projects: [{ id: "project-1", customerId: customer.id, projectCode: "P-1", projectName: "Project", status: "Active" }] as never, operators: [{ id: "operator-1", name: "Operator", status: "Active" }] as never, assignments: [{ id: "assignment-1", equipmentId: "equipment-1", operatorId: "operator-1", projectId: "project-1", status: "Active" }] as never, costCodes: [], activityCodes: [] }, initialCustomerId: customer.id, initialProjectId: "project-1" })));
    const assignment = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { assignment.click(); });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(submitted).toHaveLength(1);
    expect((submitted[0] as { assignmentIds: string[] }).assignmentIds).toEqual(["assignment-1"]);
  });
});
