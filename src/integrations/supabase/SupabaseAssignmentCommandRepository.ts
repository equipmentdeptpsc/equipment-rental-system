import type {
  AssignmentCommandRepository,
  AssignmentCancellationProjection,
  AssignmentCreationProjection,
  CancelAssignmentCommand,
  CreateAssignmentCommand,
} from "@/features/assignment/commands/contracts";
import {
  isOperationalCommandResult,
  type OperationalCommandResult,
} from "@/features/rental/operations/commands/contracts";

interface AssignmentRpcClient {
  schema(name: string): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
}

export class SupabaseAssignmentCommandRepository implements AssignmentCommandRepository {
  constructor(private readonly client: AssignmentRpcClient) {}

  async createAssignment(command: CreateAssignmentCommand): Promise<OperationalCommandResult<AssignmentCreationProjection>> {
    const { data, error } = await this.client.schema("erp").rpc("command_create_assignment", { command });
    if (error) {
      return {
        success: false,
        code: "TRANSPORT_FAILURE",
        message: "Confirmation was not received from the remote service. Refresh before retrying.",
        retryable: true,
        refreshRequired: true,
      };
    }
    const candidate = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
    if (candidate?.success === false && typeof candidate.code === "string") {
      return {
        success: false,
        code: candidate.code as Extract<OperationalCommandResult<AssignmentCreationProjection>, { success: false }>["code"],
        message: failureMessage(candidate.code),
        retryable: false,
        refreshRequired: ["CONFLICT", "EQUIPMENT_UNAVAILABLE", "PERSISTENCE_FAILURE"].includes(candidate.code),
      };
    }
    if (!isOperationalCommandResult<AssignmentCreationProjection>(data) || (data.success && !isProjection(data.value))) {
      return {
        success: false,
        code: "VALIDATION_REJECTED",
        message: "The remote Assignment command returned an invalid response.",
        retryable: false,
        refreshRequired: true,
      };
    }
    return data;
  }

  async cancelAssignment(command: CancelAssignmentCommand): Promise<OperationalCommandResult<AssignmentCancellationProjection>> {
    const { data, error } = await this.client.schema("erp").rpc("command_cancel_assignment", { command });
    if (error) {
      return { success: false, code: "TRANSPORT_FAILURE", message: "Confirmation was not received from the remote service. Refresh before retrying.", retryable: true, refreshRequired: true };
    }
    const candidate = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
    if (candidate?.success === false && typeof candidate.code === "string") {
      return {
        success: false,
        code: candidate.code as Extract<OperationalCommandResult<AssignmentCancellationProjection>, { success: false }>['code'],
        message: failureMessage(candidate.code),
        retryable: false,
        refreshRequired: ["CONFLICT", "RENTAL_CONFLICT", "PERSISTENCE_FAILURE"].includes(candidate.code),
      };
    }
    if (!isOperationalCommandResult<AssignmentCancellationProjection>(data) || (data.success && !isCancellationProjection(data.value))) {
      return { success: false, code: "VALIDATION_REJECTED", message: "The remote Assignment cancellation command returned an invalid response.", retryable: false, refreshRequired: true };
    }
    return data;
  }
}

function failureMessage(code: string) {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Your session has expired. Sign in and try again.",
    FORBIDDEN: "You do not have permission to create Assignments.",
    VALIDATION_REJECTED: "The Assignment request is incomplete or invalid.",
    NOT_FOUND: "Referenced Assignment information is unavailable. Refresh and try again.",
    EQUIPMENT_UNAVAILABLE: "The selected Equipment is unavailable for Assignment.",
    EQUIPMENT_INTERVAL_CONFLICT: "This equipment is already committed for the requested interval.",
    CONFLICT: "The Assignment identity or selected Operator is already in use.",
    IDEMPOTENCY_MISMATCH: "This request conflicts with an earlier submission. Refresh before retrying.",
    INVALID_TRANSITION: "This Assignment cannot be cancelled from its current state.",
    RENTAL_CONFLICT: "This Assignment is linked to a non-final Rental and cannot be cancelled.",
    PERSISTENCE_FAILURE: "The remote service could not save the Assignment. Refresh before retrying.",
  };
  return messages[code] ?? "The remote Assignment command was rejected.";
}

function isProjection(value: unknown): value is AssignmentCreationProjection {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.companyId === "string"
    && typeof row.equipmentId === "string"
    && typeof row.operatorId === "string"
    && typeof row.projectId === "string"
    && typeof row.assignedDate === "string"
    && (typeof row.expectedReturn === "string" || row.expectedReturn === null)
    && typeof row.remarks === "string"
    && row.status === "Active"
    && typeof row.createdAt === "string"
    && typeof row.updatedAt === "string"
    && typeof row.rowVersion === "number";
}

function isCancellationProjection(value: unknown): value is AssignmentCancellationProjection {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.equipmentId === "string"
    && typeof row.operatorId === "string"
    && row.status === "Cancelled"
    && typeof row.rowVersion === "number";
}
