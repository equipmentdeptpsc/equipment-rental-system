export type AssignmentStatus =
  | "Active"
  | "Completed"
  | "Cancelled";

export interface AssignmentRecord {
  id: string;

  equipmentId: string;

  operatorId: string;

  projectId: string;

  activityCodeId?: string;

  assignedDate: string;

  startDate?: string;

  expectedReturn?: string;

  returnedDate?: string;

  remarks: string;

  status: AssignmentStatus;

  deleted?: boolean;

  deletedAt?: number;

  rowVersion?: number;
}

export interface AssignmentFormData {
  assignmentDate?: string;

  startDate?: string;

  endDate?: string;

  equipmentId: string;

  operatorId: string;

  projectId: string;

  activityCodeId?: string;

  remarks: string;
}
