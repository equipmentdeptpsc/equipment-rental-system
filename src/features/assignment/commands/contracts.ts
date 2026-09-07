import type { OperationalCommandMetadata, OperationalCommandResult } from "@/features/rental/operations/commands/contracts";

export interface CreateAssignmentCommand extends OperationalCommandMetadata {
  assignmentId: string;
  equipmentId: string;
  operatorId: string;
  projectId: string;
  assignedDate: string;
  expectedReturn?: string;
  activityCodeId?: string;
  remarks?: string;
}

export interface AssignmentCreationProjection {
  id: string;
  companyId: string;
  equipmentId: string;
  operatorId: string;
  projectId: string;
  activityCodeId?: string;
  assignedDate: string;
  expectedReturn: string | null;
  remarks: string;
  status: "Active";
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface CancelAssignmentCommand extends OperationalCommandMetadata {
  assignmentId: string;
  expectedVersion: number;
}

export interface AssignmentCancellationProjection {
  id: string;
  equipmentId: string;
  operatorId: string;
  status: "Cancelled";
  rowVersion: number;
}

export interface AssignmentCommandRepository {
  createAssignment(command: CreateAssignmentCommand): Promise<OperationalCommandResult<AssignmentCreationProjection>>;
  cancelAssignment(command: CancelAssignmentCommand): Promise<OperationalCommandResult<AssignmentCancellationProjection>>;
}
