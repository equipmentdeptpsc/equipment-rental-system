import type { RentalRecord } from "../types";
import { getRentalApprovalStatus } from "../approval/rentalApproval";

export type RentalQuickActionId = "reserve" | "submit" | "approve" | "reject" | "release" | "activate" | "return" | "cancel" | "close";
export interface RentalQuickAction { id: RentalQuickActionId; label: string; }
export interface RentalQuickActionModel { actions: RentalQuickAction[]; message?: string; }
export function visibleRentalQuickActions(model: RentalQuickActionModel, hideClose: boolean) {
  return hideClose ? model.actions.filter((action) => action.id !== "close") : model.actions;
}

export interface RentalQuickActionPermissions {
  readonly manage: boolean;
  readonly approve: boolean;
  readonly submit?: boolean;
  readonly release: boolean;
  readonly return: boolean;
}
export function deriveRentalQuickActions(rental: RentalRecord, input: RentalQuickActionPermissions | "Admin" | "Manager" | "Operator"): RentalQuickActionModel {
  const permissions = typeof input === "string"
    ? { manage: input === "Admin", approve: input === "Manager", submit: input === "Admin", release: input === "Admin", return: input === "Admin" }
    : input;
  const approval = getRentalApprovalStatus(rental);
  if (rental.status === "Draft" || rental.status === "Assigned") return { actions: permissions.manage ? [{ id: "reserve", label: "Reserve Rental" }] : [] };
  if (rental.status === "Reserved") {
    if (approval === "Pending") return permissions.approve ? { actions: [{ id: "approve", label: "Approve Rental" }, { id: "reject", label: "Reject Rental" }], message: "Awaiting Manager Approval" } : { actions: [], message: "Awaiting Manager Approval" };
    if (approval === "Approved") return { actions: permissions.release ? [{ id: "release", label: "Release Equipment" }] : [], message: "Approved" };
    if (approval === "Rejected") return { actions: (permissions.submit ?? permissions.approve) ? [{ id: "submit", label: "Send to Approver" }] : [], message: rental.approvalDecisionRemarks ? `Rejected: ${rental.approvalDecisionRemarks}` : "Rejected" };
    return { actions: (permissions.submit ?? permissions.approve) ? [{ id: "submit", label: "Send to Approver" }] : [] };
  }
  if (rental.status === "Released") return { actions: permissions.manage ? [{ id: "activate", label: "Activate Rental" }] : [] };
  if (rental.status === "Active") return { actions: permissions.return ? [{ id: "return", label: "Return Equipment" }] : [] };
  if (rental.status === "Returned") return { actions: permissions.manage ? [{ id: "close", label: "Close Rental" }] : [] };
  return { actions: [] };
}
