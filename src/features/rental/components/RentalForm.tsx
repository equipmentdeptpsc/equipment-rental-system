import { useEffect, useMemo, useRef, useState } from "react";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { useFormSubmission } from "@/components/form/useFormSubmission";

import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useCustomer } from "@/features/customer/context/CustomerContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import {
  getRentalEquipmentLabel,
  getRentalProjectOptions,
} from "@/features/rental/utils/rentalFormOptions";
import { localCalendarDate, validateNewRentalDates } from "@/features/rental/utils/rentalDateValidation";
import { rentalTypes, type DeurExpectationFrequency, type DeurExpectationShiftCode, type RentalBillingMethod, type RentalType } from "@/features/rental/types";
import { deurShiftWindowRepository } from "@/features/rental/deur/shift-window/repository";
import type { AssignmentRecord } from "@/features/assignment/types";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useCostCodes } from "@/features/masters/cost-code/context/useCostCodes";
import { useActivityCodes } from "@/features/masters/activity-code";
import { createRentalOperationalMetadataSnapshot } from "@/features/rental/services/createRentalOperationalMetadataSnapshot";
import { selectableRentalEquipment } from "@/features/rental/services/selectableRentalEquipment";
import RentalOperationalMetadataCard from "./RentalOperationalMetadataCard";
import { getAssignmentDisplayName, getAssignmentNumber } from "@/features/assignment/utils/assignmentDisplay";
import type { EquipmentRecord } from "@/features/equipment/types";
import type { CustomerRecord } from "@/features/customer/types";
import type { ProjectRecord } from "@/features/project/types";
import type { Operator } from "@/features/operators/types";
import type { CanonicalReferenceCode } from "@/features/rental/remote/contracts";

export interface RentalFormData {
  equipmentId: string;
  customerId: string;
  customer: string;
  customerRepresentativeName?: string;
  customerReviewEmail?: string;
  operatorId: string;
  projectId: string;
  dateOut: string;
  expectedReturn?: string;
  rentalType: RentalType | "";
  /** Legacy compatibility input only. Rental creation does not render or persist this header value. */
  billingMethod?: RentalBillingMethod | "";
  deurExpectationFrequency: DeurExpectationFrequency;
  expectedShiftCodes: DeurExpectationShiftCode[];
  assignmentIds: string[];
}

interface Props {
  onSubmit(data: RentalFormData): void | Promise<void>;

  initialEquipmentId?: string;

  initialProjectId?: string;
  initialCustomerId?: string;

  initialOperatorId?: string;

  lockEquipment?: boolean;

  lockOperator?: boolean;
  lockCustomer?: boolean;
  lockProject?: boolean;

  initialProjectWarning?: string;

  assignment?: AssignmentRecord;
  initialAssignmentIds?: string[];
  canonicalData?: { equipment: EquipmentRecord[]; customers: CustomerRecord[]; projects: ProjectRecord[]; operators: Operator[]; assignments: AssignmentRecord[]; costCodes: CanonicalReferenceCode[]; activityCodes: CanonicalReferenceCode[] };
}

export const EXPECTED_RETURN_GUIDANCE = "Leave blank for an open-ended rental. The rental remains active until the equipment is formally returned.";
export const RENTAL_TYPE_GUIDANCE: Partial<Record<RentalType, string>> = {
  "Operated Rental": "Equipment is provided with a rental-company operator. Digital DEUR and operator activity tracking are required.",
  "Bare Rental": "Equipment is rented without a rental-company operator. The customer is responsible for operating the equipment.",
};
export const DEUR_FREQUENCY_GUIDANCE: Record<DeurExpectationFrequency, string> = {
  PER_WORKDAY: "Create one DEUR for each equipment item for each work date. One DEUR may contain several activities and, where supported, multiple operator handovers.",
  PER_SHIFT: "Create a separate DEUR for each required shift, such as Day Shift or Night Shift.",
  ON_DEMAND: "Create a DEUR only when equipment activity must be recorded. Use this for irregular, call-out, or non-daily work.",
};

export default function RentalForm({
  onSubmit,
  initialEquipmentId,
  initialProjectId,
  initialCustomerId,
  initialOperatorId,
  lockEquipment = false,
  lockOperator = false,
  lockCustomer = false,
  lockProject = false,
  initialProjectWarning,
  assignment,
  initialAssignmentIds = [],
  canonicalData,
}: Props) {
  const submission=useFormSubmission("Rental",onSubmit);
  const { equipment: localEquipment } =
    useEquipment();

  const { customers: localCustomers } =
    useCustomer();

  const { projects: localProjects } = useProject();
  const { operators: localOperators } = useOperator();
  const { assignments: localAssignments } = useAssignment();
  const equipment = canonicalData?.equipment ?? localEquipment;
  const customers = canonicalData?.customers ?? localCustomers;
  const projects = canonicalData?.projects ?? localProjects;
  const operators = canonicalData?.operators ?? localOperators;
  const assignments = canonicalData?.assignments ?? localAssignments;
  const { costCodes } = useCostCodes();
  const { records: activityCodes } = useActivityCodes();
  const metadataCostCodes = canonicalData?.costCodes ?? costCodes.map((record) => ({ id: record.id, code: record.code, name: record.description }));
  const metadataActivityCodes = canonicalData?.activityCodes ?? activityCodes.map((record) => ({ id: record.id, code: record.activityCode, name: record.description }));

  const availableEquipment =
    useMemo(() => {
      const available = selectableRentalEquipment(equipment);
  
      if (!initialEquipmentId)
        return available;
  
      const selected =
        equipment.find(
          e =>
            e.id ===
            initialEquipmentId
        );
  
      if (
        selected &&
        !available.some(
          e =>
            e.id ===
            selected.id
        )
      ) {
  
        return [
          selected,
          ...available,
        ];
  
      }
  
      return available;
  
    }, [
      equipment,
      initialEquipmentId,
    ]);

  const equipmentOptions =
    useMemo(
      () => [
        {
          value: "",
          label:
            "Select Equipment",
        },

        ...availableEquipment.map(
          (e) => ({
            value: e.id,
            label: getRentalEquipmentLabel(e),
          })
        ),
      ],
      [availableEquipment]
    );

  const customerOptions =
    useMemo(
      () => [
        {
          value: "",
          label:
            "Select Customer",
        },

        ...customers.map((c) => ({
          value: c.id,
          label:`${c.customerCode} — ${c.companyName}`,
        })),
      ],
      [customers]
    );

  const operatorOptions = useMemo(() => {
    const available = operators.filter((operator) => operator.status === "Active");
    const selected = initialOperatorId ? operators.find((operator) => operator.id === initialOperatorId) : undefined;
    const choices = selected && !available.some((operator) => operator.id === selected.id)
      ? [selected, ...available]
      : available;
    return [{ value: "", label: "Select Operator" }, ...choices.map((operator) => ({ value: operator.id, label: operator.name }))];
  }, [initialOperatorId, operators]);

  const [form, setForm] =
    useState<RentalFormData>({
      equipmentId:
        initialEquipmentId ??
        "",

      customerId: initialCustomerId ?? "",
  
      customer: customers.find((item) => item.id === initialCustomerId)?.companyName ?? "",
      customerRepresentativeName: customers.find((item) => item.id === initialCustomerId)?.contactPerson ?? "",
      customerReviewEmail: customers.find((item) => item.id === initialCustomerId)?.email ?? "",
      operatorId: initialOperatorId ?? "",
  
      projectId: initialProjectId ?? "",
      dateOut: localCalendarDate(),
  
      expectedReturn: "",
      rentalType: "",
      deurExpectationFrequency: "PER_WORKDAY",
      expectedShiftCodes: ["DAY"],
      assignmentIds: initialAssignmentIds,
  
    });
  const editedContactFields = useRef(new Set<"customerRepresentativeName" | "customerReviewEmail">());

  const projectOptions = useMemo(
    () => [
      { value: "", label: form.customerId ? "Select Project" : "Select Customer first" },
      ...getRentalProjectOptions(projects, form.customerId),
    ],
    [projects, form.customerId]
  );

  const selectedEquipment = equipment.find((record) => record.id === form.equipmentId);
  const metadataPreview = selectedEquipment
    ? createRentalOperationalMetadataSnapshot({ equipment: selectedEquipment, assignment, costCodes: metadataCostCodes, activityCodes: metadataActivityCodes })
    : undefined;

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      equipmentId: initialEquipmentId ?? prev.equipmentId,
      customerId: initialCustomerId ?? prev.customerId,
      customer: customers.find((item) => item.id === initialCustomerId)?.companyName ?? prev.customer,
      customerRepresentativeName: editedContactFields.current.has("customerRepresentativeName")
        ? prev.customerRepresentativeName
        : customers.find((item) => item.id === initialCustomerId)?.contactPerson ?? prev.customerRepresentativeName,
      customerReviewEmail: editedContactFields.current.has("customerReviewEmail")
        ? prev.customerReviewEmail
        : customers.find((item) => item.id === initialCustomerId)?.email ?? prev.customerReviewEmail,
      projectId: initialProjectId && !prev.projectId ? initialProjectId : prev.projectId,
      operatorId: initialOperatorId ?? prev.operatorId,
    }));
  }, [customers, initialCustomerId, initialEquipmentId, initialProjectId, initialOperatorId]);

  function update<
    K extends keyof RentalFormData
  >(
    key: K,
    value: RentalFormData[K]
  ) {
    if (key === "customerRepresentativeName" || key === "customerReviewEmail") {
      editedContactFields.current.add(key);
    }
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  return (
    <form
      className="app-card space-y-5 p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (submission.busy) return;

        const dateError = validateNewRentalDates(form.dateOut, form.expectedReturn);
        if (dateError) {
          submission.fail(dateError);
          return;
        }
        if (form.deurExpectationFrequency === "PER_SHIFT" && form.expectedShiftCodes.length === 0) {
          submission.fail("Select at least one expected DEUR shift.");
          return;
        }

        void submission.submit({ ...form, expectedReturn: form.expectedReturn || undefined });
      }}
    >
      {submission.feedback}
      <Select
        searchable clearable
        label="Equipment"
        value={
          form.equipmentId
        }
        disabled={
          lockEquipment
        }
        options={
          equipmentOptions
        }
        onChange={(e) =>
          update(
            "equipmentId",
            e.target.value
          )
        }
      />

      <Select
        searchable clearable
        label="Customer"
        value={form.customerId}
        disabled={lockCustomer}
        options={
          customerOptions
        }
        onChange={(e) => {
            const customer = customers.find(
              (item) => item.id === e.target.value
            );
            editedContactFields.current.delete("customerRepresentativeName");
            editedContactFields.current.delete("customerReviewEmail");
            setForm((previous) => ({ ...previous, customerId: e.target.value, customer: customer?.companyName ?? "", customerRepresentativeName: customer?.contactPerson ?? "", customerReviewEmail: customer?.email ?? "", projectId: projects.some((project) => project.id === previous.projectId && project.customerId === e.target.value) ? previous.projectId : "", assignmentIds: [] }));
          }}
      />

      <Select
          searchable clearable
          label="Project"
          value={form.projectId}
          disabled={lockProject || !form.customerId}
          options={projectOptions}
          onChange={(e) => update("projectId", e.target.value)}
      />

      <Input
        type="text"
        label="Customer Representative"
        value={form.customerRepresentativeName}
        onChange={(e) => update("customerRepresentativeName", e.target.value)}
      />

      <Input
        type="email"
        label="Customer Review Email"
        value={form.customerReviewEmail}
        onChange={(e) => update("customerReviewEmail", e.target.value)}
      />

      <fieldset className="rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Equipment Lines from Active Assignments</legend>
        <p className="mb-3 text-xs text-slate-500">Select one or more Assignments from the Rental Project. Leave all unchecked to use the single Equipment and Operator fields above.</p>
        <div className="space-y-2">
          {assignments.filter((item) => item.status === "Active" && (!form.projectId || item.projectId === form.projectId)).map((item) => {
            const machine = equipment.find((record) => record.id === item.equipmentId);
            const operator = operators.find((record) => record.id === item.operatorId);
            const duplicateSelected = form.assignmentIds.some((id) => id !== item.id && assignments.find((candidate) => candidate.id === id)?.equipmentId === item.equipmentId);
            const eligible = Boolean(machine && !machine.deleted && machine.active !== false && ["Available", "Assigned"].includes(machine.status));
            return <label key={item.id} className={`flex items-center gap-3 rounded border p-3 text-sm ${eligible && !duplicateSelected ? "" : "opacity-50"}`}>
              <input type="checkbox" disabled={!eligible || duplicateSelected} checked={form.assignmentIds.includes(item.id)} onChange={(event) => update("assignmentIds", event.target.checked ? [...form.assignmentIds, item.id] : form.assignmentIds.filter((id) => id !== item.id))} />
              <span><strong>{getAssignmentDisplayName({ assignment: item, equipment: machine, operator, project: projects.find((record) => record.id === item.projectId) })}</strong><br /><span className="text-xs text-slate-500">{getAssignmentNumber(item.id, assignments)}</span></span>
            </label>;
          })}
        </div>
      </fieldset>

      {form.assignmentIds.length <= 1 && <Select
        searchable clearable
        label="Operator"
        value={form.operatorId}
        disabled={lockOperator}
        options={operatorOptions}
        onChange={(e) => update("operatorId", e.target.value)}
      />}

      {form.assignmentIds.length > 1 && <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Each equipment line uses the operator from its selected Assignment. No rental-level operator is applied.</p>}

      <Select
        label="Rental Type"
        value={form.rentalType}
        options={[{ value: "", label: "Select Rental Type" }, ...rentalTypes.map((value) => ({ value, label: value }))]}
        onChange={(e) => update("rentalType", e.target.value as RentalFormData["rentalType"])}
      />
      <p className="text-xs text-slate-600">{RENTAL_TYPE_GUIDANCE[form.rentalType as RentalType] ?? "Select the operating arrangement for this rental."}</p>

      <Select
        label="DEUR Reporting Frequency"
        value={form.deurExpectationFrequency}
        options={[{ value: "PER_WORKDAY", label: "Per Workday" }, { value: "PER_SHIFT", label: "Per Shift" }, { value: "ON_DEMAND", label: "On Demand" }]}
        onChange={(e) => update("deurExpectationFrequency", e.target.value as DeurExpectationFrequency)}
      />
      <p className="text-xs text-slate-600">{DEUR_FREQUENCY_GUIDANCE[form.deurExpectationFrequency]}</p>

      {form.deurExpectationFrequency === "PER_SHIFT" && <fieldset className="rounded border p-3">
        <legend className="px-1 text-sm font-medium">Expected Shifts</legend>
        <div className="flex gap-4">{(["DAY", "NIGHT"] as const).map((shift) => <label key={shift} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.expectedShiftCodes.includes(shift)} onChange={(event) => update("expectedShiftCodes", event.target.checked ? [...form.expectedShiftCodes, shift] : form.expectedShiftCodes.filter((item) => item !== shift))} /> {shift === "DAY" ? "Day" : "Night"}
        </label>)}</div>
        <div className="mt-2 text-xs text-slate-600">{deurShiftWindowRepository.getAll().filter((window) => form.expectedShiftCodes.includes(window.code)).map((window) => <p key={window.code}>{window.label}: {window.startTime}–{window.endTime}{window.endTime <= window.startTime ? " next day" : ""}</p>)}</div>
      </fieldset>}

      <p className="text-xs text-slate-500">The DEUR expectation policy becomes read-only when the Rental is released.</p>

      {lockOperator && <p className="text-sm text-slate-500">Operator is inherited from the selected assignment.</p>}

      {initialProjectWarning && <p className="text-sm text-amber-700">The assignment’s project is unavailable or inactive. Select another active project.</p>}

      {form.customerId && projectOptions.length === 1 && (
        <p className="text-sm text-slate-500">
          This Customer has no active Projects. <a className="text-blue-600 underline" href="/projects/new">Create Project</a> before creating a Rental.
        </p>
      )}

      <RentalOperationalMetadataCard
        title="Inherited Operational Metadata"
        metadata={metadataPreview?.snapshot ?? {}}
        costCodeMissingLabel={metadataPreview?.issues.some((issue) => issue.code === "COST_CODE_NOT_FOUND")
          ? "Cost Code not found" : metadataPreview?.issues.some((issue) => issue.code === "COST_CODE_INVALID")
            ? "Cost Code configuration is invalid" : "Cost Code not configured"}
        activityCodeMissingLabel={metadataPreview?.issues.some((issue) => issue.code === "ACTIVITY_CODE_NOT_FOUND")
          ? "Activity Code not found" : metadataPreview?.issues.some((issue) => issue.code === "ACTIVITY_CODE_INVALID")
            ? "Activity Code configuration is invalid" : "Activity Code not configured"}
      />

      <Input
        type="date"
        label="Rental Start Date"
        min={localCalendarDate()}
        value={form.dateOut}
        onChange={(e) => {
          const dateOut = e.target.value;
          setForm((prev) => ({
            ...prev,
            dateOut,
            expectedReturn: prev.expectedReturn && prev.expectedReturn < dateOut ? "" : prev.expectedReturn,
          }));
        }}
      />

      <Input
        type="date"
        label="Expected Return (Optional)"
        min={form.dateOut || localCalendarDate()}
        value={
          form.expectedReturn ?? ""
        }
        onChange={(e) =>
          update(
            "expectedReturn",
            e.target.value
          )
        }
      />
      <p className="text-xs text-slate-600">{EXPECTED_RETURN_GUIDANCE}</p>

      <div className="flex justify-end">
        <Button type="submit" disabled={submission.busy}>
          {submission.busy?"Saving...":"Save Rental"}
        </Button>
      </div>
    </form>
  );
}
