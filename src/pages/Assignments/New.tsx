import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import AssignmentForm from "@/features/assignment/components/AssignmentForm";

import type {
  AssignmentFormData,
} from "@/features/assignment/components/AssignmentForm";

import type {
  AssignmentRecord,
} from "@/features/assignment/types";

import {
  useAssignment,
} from "@/features/assignment/context/AssignmentContext";

import {
  useEquipment,
} from "@/features/equipment/context/EquipmentContext";

import {
  useEquipmentHistory,
} from "@/features/equipment/history";

import {
  useAudit,
} from "@/features/equipment/audit/AuditContext";

import {
  assignEquipment,
  assignmentHistory,
  auditAssignment,
} from "@/features/equipment/application";

import {
  createAssignmentWorkflow,
} from "@/features/assignment/application";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { getAssignmentRuntimeCapability, REMOTE_ASSIGNMENT_MUTATION_UNAVAILABLE_MESSAGE } from "@/features/assignment/services/assignmentRuntimeCapability";
import RemoteAssignmentForm from "@/features/assignment/components/RemoteAssignmentForm";
import { useAuth } from "@/features/auth/AuthContext";
import PageHeader from "@/components/ui/PageHeader";

export default function NewAssignment() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const capability = getAssignmentRuntimeCapability(configuration, Boolean(commandRepositories.canonicalAssignment));
  if (capability.canonicalCreation && hasPermission("assignment.create")) return <RemoteAssignmentForm />;
  if (!capability.legacyMutations) return <div className="mx-auto max-w-3xl space-y-4"><PageHeader title="New Assignment" description="Create a clear equipment booking for a project and operator." /><div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status"><h2 className="font-semibold">Assignment creation unavailable</h2><p className="mt-1 text-sm">{REMOTE_ASSIGNMENT_MUTATION_UNAVAILABLE_MESSAGE}</p></div></div>;
  return <LocalNewAssignment />;
}

function LocalNewAssignment() {
  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const equipmentId =
    searchParams.get(
      "equipment"
    ) ?? "";

  const { addAssignment, isEquipmentAssigned } =
    useAssignment();

  const {
    getEquipment,
    updateEquipment,
  } = useEquipment();

  const { log } =
    useEquipmentHistory();

  const { logAction } =
    useAudit();

    async function handleSubmit(
      data: AssignmentFormData
    ) {
      const workflow =
      await createAssignmentWorkflow(
        data,
        {
          getEquipment,
          updateEquipment,
          isEquipmentAssigned,
        }
      );
      if (!workflow.success) {
        throw new Error(workflow.message ?? "Assignment failed.");
      }

      const equipment =
  getEquipment(
    data.equipmentId
  );
  
    const assignment: AssignmentRecord =
      {
        id: crypto.randomUUID(),

        equipmentId:
          data.equipmentId,

        operatorId:
          data.operatorId,

        projectId:
          data.projectId,

        activityCodeId:
          data.activityCodeId || undefined,

        assignedDate:
          data.assignmentDate!,

        startDate: data.startDate!,

        expectedReturn:
          data.endDate!,

        remarks:
          data.remarks,

        status:
          "Active",
      };

    let success = false;
    try { success = addAssignment(assignment); } catch (error) {
      throw error instanceof Error ? error : new Error("Assignment failed.");
    }

    if (!success) {
      throw new Error("Equipment or operator is already booked for the selected dates.");
    }

    if (equipment) {
      const {
        equipment:
          updatedEquipment,
      } = assignEquipment(
        equipment,
        data.projectId,
        data.operatorId
      );

      updateEquipment(
        updatedEquipment
      );

      logAction(
        auditAssignment(
          equipment,
          updatedEquipment
        )
      );

      log(
        assignmentHistory(
          equipment.id
        )
      );
    }

    navigate(
      "/assignments"
    );
  }

  return (
    <div className="app-page mx-auto max-w-3xl">

      <PageHeader title="New Assignment" description="Assign equipment to a project and operator." />

      <AssignmentForm
        onSubmit={
          handleSubmit
        }
        initialEquipmentId={
          equipmentId ||
          undefined
        }
      />

    </div>
  );
}
