import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import RentalForm from "@/features/rental/components/RentalForm";

import type {
  RentalFormData,
} from "@/features/rental/components/RentalForm";

import { useRental } from "@/features/rental/context/RentalContext";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useCustomer } from "@/features/customer/context/CustomerContext";

import { generateRentalNumber } from "@/features/rental/utils/generateRentalNumber";
import {
  getAssignmentProjectError,
  getRentalAssignmentPrefill,
} from "@/features/rental/utils/rentalFormOptions";
import { resolveAssignmentRentalLookup } from "@/features/rental/utils/assignmentRentalLookup";
import { isValidBusinessEmail, normalizeBusinessEmail } from "@/shared/validation/email";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseLegacyRentalMutations, REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE } from "@/features/rental/services/rentalRuntimeCapability";
import { canUseCanonicalRemoteRentalCreation } from "@/features/rental/services/rentalRuntimeCapability";
import { requestCanonicalRentalRefresh } from "@/features/rental/remote/canonicalRentalRefresh";
import { useAuth } from "@/features/auth/AuthContext";
import { useMemo, useRef } from "react";
import { isRentalType } from "@/features/rental/types";
import { useRentalListData } from "@/features/rental/hooks/useRentalListData";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { resolveAssignmentRentalOrigin } from "@/features/rental/services/resolveAssignmentRentalOrigin";

export default function NewRental() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const localCreation = canUseLegacyRentalMutations(configuration);
  const remoteCreation = canUseCanonicalRemoteRentalCreation(configuration) && Boolean(commandRepositories.canonicalRental) && hasPermission("rental.create");
  const creationAvailable = localCreation || remoteCreation;
  const remoteSubmission = useRef<{ commandId: string; idempotencyKey: string } | undefined>(undefined);
  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const assignmentQuery = searchParams.get("assignment");

  const equipmentParam =
    searchParams.get(
      "equipment"
    );

  const { assignments: localAssignments } = useAssignment();
  const localEquipment = useEquipment().equipment;
  const localOperators = useOperator().operators;

  const { addRental, rentals, rentalEquipmentLines } = useRental();

  const { projects: localProjects } = useProject();
  const { customers: localCustomers }=useCustomer();
  const fallbackData = useMemo(() => ({ rentals, rentalEquipmentLines, equipment: localEquipment, assignments: localAssignments, operators: localOperators, projects: localProjects, customers: localCustomers, costCodes: [], activityCodes: [] }), [rentals, rentalEquipmentLines, localEquipment, localAssignments, localOperators, localProjects, localCustomers]);
  const canonicalData = useRentalListData(fallbackData);
  const { assignments, projects, customers } = canonicalData.data;
  const assignmentLookup = resolveAssignmentRentalLookup(assignmentQuery, assignments, canonicalData.status === "loading");
  const assignment = assignmentLookup.state === "found" ? assignmentLookup.assignment : undefined;
  const assignmentOrigin = assignment ? resolveAssignmentRentalOrigin(assignment, projects, customers) : undefined;
  const initialEquipmentId = assignment?.equipmentId ?? equipmentParam ?? "";
  const assignmentPrefill = getRentalAssignmentPrefill(assignment);
  const assignmentProjectError = assignmentOrigin && !assignmentOrigin.success ? assignmentOrigin.message : getAssignmentProjectError(assignment, projects);

  async function handleSubmit(
    data: RentalFormData
  ) {
    const selectedProject = projects.find((project) => project.id === data.projectId);
    const selectedCustomer=customers.find(customer=>customer.id===data.customerId);
    if(!selectedCustomer||!data.customerRepresentativeName?.trim()||!data.customerReviewEmail||!isValidBusinessEmail(data.customerReviewEmail)){throw new Error("A valid rental-specific Customer representative and review email are required.")}
    if (!selectedProject || selectedProject.customerId !== data.customerId) {
      throw new Error("The selected Project must belong to the selected Customer.");
    }
    const rentalId =
      crypto.randomUUID();

      
      const selectedAssignments = data.assignmentIds.map((id) => assignments.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const lineInputs = selectedAssignments.length
        ? selectedAssignments.map((item) => ({ equipmentId: item.equipmentId, operatorId: item.operatorId, assignmentId: item.id }))
        : [{ equipmentId: data.equipmentId, operatorId: data.operatorId, assignmentId: assignmentPrefill.assignmentId }];
      const soleLine = lineInputs.length === 1 ? lineInputs[0] : undefined;

      const rental = {
        id: rentalId,

        rentalNumber: generateRentalNumber(rentals),
      
        equipmentId:
          soleLine?.equipmentId ?? "",

        customerId: data.customerId,
        customerContactSnapshot:{representativeName:data.customerRepresentativeName.trim(),representativeEmail:normalizeBusinessEmail(data.customerReviewEmail),contactNumber:selectedCustomer.contactNumber,capturedAt:new Date().toISOString()},

        projectId: data.projectId,

        operatorId: soleLine?.operatorId,

        assignmentId: soleLine?.assignmentId,
      
        customer:
          data.customer,
      
        project: selectedProject.projectName,
      
        rentedBy:
          "",
      
        dateOut: data.dateOut,
      
        expectedReturn:
          data.expectedReturn,

        rentalType: data.rentalType || undefined,

        deurExpectationPolicyRequired: true,

        deurExpectationPolicy: {
          frequency: data.deurExpectationFrequency,
          effectiveFrom: data.dateOut,
          ...(data.deurExpectationFrequency === "PER_SHIFT" ? { expectedShiftCodes: data.expectedShiftCodes } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          capturedAt: new Date().toISOString(),
        },
      
      };

    if (remoteCreation) {
      if (!isRentalType(data.rentalType)) throw new Error("Select a Rental type.");
      const identity = remoteSubmission.current ??= { commandId: rentalId, idempotencyKey: crypto.randomUUID() };
      const result = await commandRepositories.canonicalRental!.createDraft({
        ...identity, customerId: data.customerId, projectId: data.projectId, dateOut: data.dateOut,
        expectedReturn: data.expectedReturn || undefined, rentalType: data.rentalType,
        lines: data.assignmentIds.map((assignmentId) => ({ assignmentId })),
      });
      if (!result.success) throw new Error(result.message);
      requestCanonicalRentalRefresh();
      navigate(`/rentals/${result.value.rentalId}/commercial-terms`);
      return;
    }

    const result = addRental(rental, lineInputs);

    if (!result.success) {
      throw new Error(result.message ?? "Unable to create rental.");
    }

    navigate(
      `/rentals/${rentalId}/commercial-terms`
    );
  }

  if (!creationAvailable) return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-3xl font-bold">New Rental</h1>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950" role="status">
        <h2 className="font-semibold">Rental creation unavailable</h2>
        <p className="mt-1 text-sm">{REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE}</p>
      </div>
    </div>
  );
  if (remoteCreation && canonicalData.status === "loading") return <div className="p-6">Loading canonical Rental data…</div>;
  if (remoteCreation && canonicalData.status === "error") return <div className="p-6" role="alert">{canonicalData.message}<button className="ml-3 underline" onClick={canonicalData.retry}>Retry</button></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">

      <div>

        <h1 className="text-3xl font-bold">
          New Rental
        </h1>

        <p className="mt-2 text-gray-500">

          {assignment
            ? "Rental is being created from an existing assignment."
            : "Create a rental transaction."}

        </p>

      </div>

      {assignmentLookup.state === "loading" ? <p className="text-slate-500">Loading assignment…</p> : "message" in assignmentLookup ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{assignmentLookup.message}</p> : assignmentOrigin && !assignmentOrigin.success ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700" role="alert">{assignmentOrigin.message}</p> : <RentalForm
        onSubmit={
          handleSubmit
        }
        initialEquipmentId={
          initialEquipmentId ||
          undefined
        }
        initialProjectId={assignmentPrefill.projectId}
        initialCustomerId={assignmentOrigin?.success ? assignmentOrigin.customer.id : undefined}
        initialOperatorId={assignmentPrefill.operatorId}
        lockEquipment={Boolean(assignment)}
        lockOperator={Boolean(assignment)}
        lockCustomer={Boolean(assignmentOrigin?.success)}
        lockProject={Boolean(assignmentOrigin?.success)}
        initialProjectWarning={assignmentProjectError}
        assignment={assignment}
        initialAssignmentIds={assignment ? [assignment.id] : []}
        canonicalData={remoteCreation ? { equipment: canonicalData.data.equipment, customers, projects, operators: canonicalData.data.operators, assignments, costCodes: canonicalData.data.costCodes, activityCodes: canonicalData.data.activityCodes } : undefined}
      />}

    </div>
  );
}
