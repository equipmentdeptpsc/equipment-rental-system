import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@/features/auth/domain/user";
import type { EquipmentRecord } from "@/features/equipment/types";
import type { RentalRecord } from "@/features/rental/types";
import type { AssignmentRecord } from "@/features/assignment/types";
import type { Operator } from "@/features/operators/types";
import type { CustomerRecord } from "@/features/customer/types";
import type { ProjectRecord } from "@/features/project/types";
import type { BillingStatement } from "@/features/rental/billingstatement/types";
import type { CanonicalDeurEvent, DeurRecord } from "@/features/rental/deur/types";
import type { RentalEquipmentLine } from "@/features/rental/equipment-line/types";
import type { WorkDescriptionRecord } from "@/features/masters/work-description/types";
import type { CanonicalAuditEvent } from "@/features/administration/domain/canonicalAudit";
import { SupabaseCertificationReadRepository } from "./SupabaseCertificationRepository";
import type { RemoteCore } from "@/core/remote";
import { repositoryFailure, repositorySuccess, type RepositoryResult } from "@/core/persistence";
import { SupabaseReadRepository, mapCanonicalRow } from "./SupabaseReadRepository";
import { SupabaseOperatorCertificationRepository } from "@/features/operators/certifications/repository";
import { SupabaseEquipmentSubcategoryRepository } from "./SupabaseEquipmentSubcategoryRepository";
import { SupabaseEquipmentMaintenanceSnapshotRepository } from "./SupabaseEquipmentMaintenanceSnapshotRepository";
import { SupabaseCanonicalBookingReadRepository } from "./SupabaseCanonicalBookingReadRepository";
import { SupabaseEquipmentAvailabilityRepository } from "./SupabaseEquipmentAvailabilityRepository";
import { SupabaseEquipmentRentalLifecycleHistoryRepository } from "./SupabaseEquipmentRentalLifecycleHistoryRepository";
import { SupabaseEquipmentLifecycleSummaryRepository } from "./SupabaseEquipmentLifecycleSummaryRepository";

export function createSupabaseReadRepositories(client: SupabaseClient, core: RemoteCore) {
  return {
    users: new SupabaseReadRepository<User>(client, { repositoryName: "User", table: "users", columns: "id,username,display_name,email,company_id,status,operator_id,credential_mode,created_at,updated_at,user_roles(app_roles(code))", searchColumns: ["username", "display_name", "email"], mapRow: mapUser }, core),
    equipment: new SupabaseReadRepository<EquipmentRecord>(client, { repositoryName: "Equipment", table: "equipment_read_model", searchColumns: ["asset_no", "equipment_name", "serial_number", "subcategory_name"] }, core),
    rentals: new SupabaseReadRepository<RentalRecord>(client, { repositoryName: "Rental", table: "rentals", searchColumns: ["rental_number", "customer_snapshot", "project_snapshot"], mapRow: mapRental }, core),
    assignments: new SupabaseReadRepository<AssignmentRecord>(client, { repositoryName: "Assignment", table: "assignments", searchColumns: ["remarks"], mapRow: mapAssignment }, core),
    operators: new SupabaseReadRepository<Operator>(client, { repositoryName: "Operator", table: "operators", searchColumns: ["name", "email", "license_number"] }, core),
    customers: new SupabaseReadRepository<CustomerRecord>(client, { repositoryName: "Customer", table: "customers", searchColumns: ["customer_code", "name", "email", "phone"], mapRow: mapCustomer }, core),
    projects: new SupabaseReadRepository<ProjectRecord>(client, { repositoryName: "Project", table: "projects", searchColumns: ["project_code", "name", "location"], mapRow: mapProject }, core),
    billing: new SupabaseReadRepository<BillingStatement>(client, { repositoryName: "BillingStatement", table: "billing_statements", columns: "*,billing_statement_lines(*)", searchColumns: ["statement_no", "invoice_number", "customer_snapshot", "project_snapshot"], mapRow: mapBillingStatement }, core),
    deurs: new SupabaseReadRepository<DeurRecord>(client, { repositoryName: "DEUR", table: "deurs", columns: "*,deur_events(*)", searchColumns: ["deur_number", "operational_remarks"], mapRow: mapDeur }, core),
    rentalEquipmentLines: new SupabaseReadRepository<RentalEquipmentLine>(client, { repositoryName: "RentalEquipmentLine", table: "rental_equipment_lines", mapRow: mapRentalEquipmentLine }, core),
    canonicalBookings: new SupabaseCanonicalBookingReadRepository(client),
    equipmentAvailability: new SupabaseEquipmentAvailabilityRepository(client),
    workDescriptions: new SupabaseReadRepository<WorkDescriptionRecord>(client, { repositoryName: "WorkDescription", table: "work_descriptions", searchColumns: ["code", "name"] }, core),
    canonicalAudit: new SupabaseReadRepository<CanonicalAuditEvent>(client, { repositoryName: "CanonicalAudit", table: "audit_log", columns: "id,company_id,aggregate_type,aggregate_id,action,actor_id,actor_name,occurred_at,correlation_id", searchColumns: ["aggregate_type", "aggregate_id", "action", "actor_id", "actor_name"], mapRow: mapCanonicalAudit }, core),
    certificationTypes: new SupabaseCertificationReadRepository(client),
    equipmentSubcategories: new SupabaseEquipmentSubcategoryRepository(client),
    maintenance: new SupabaseEquipmentMaintenanceSnapshotRepository(client),
    rentalLifecycleHistory: new SupabaseEquipmentRentalLifecycleHistoryRepository(client),
    lifecycleSummary: new SupabaseEquipmentLifecycleSummaryRepository(client),
    operatorCertifications: new SupabaseOperatorCertificationRepository(client),
  };
}
export function mapCanonicalAudit(row: Record<string, unknown>): RepositoryResult<CanonicalAuditEvent> {
  const base = mapCanonicalRow<Record<string, unknown>>(row); if (!base.success) return base;
  const value = base.value;
  if (typeof value.aggregateType !== "string" || typeof value.aggregateId !== "string" || typeof value.action !== "string" || typeof value.occurredAt !== "string") return repositoryFailure("REMOTE_ROW_MALFORMED", "Remote audit event is missing canonical identity fields.", { context: { repository: "CanonicalAudit" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical audit row." });
  return repositorySuccess({ id: String(value.id), companyId: typeof value.companyId === "string" ? value.companyId : undefined, aggregateType: value.aggregateType, aggregateId: value.aggregateId, action: value.action, actorId: typeof value.actorId === "string" ? value.actorId : undefined, actorName: typeof value.actorName === "string" ? value.actorName : undefined, occurredAt: value.occurredAt, correlationId: typeof value.correlationId === "string" ? value.correlationId : undefined });
}
export function mapDeur(row: Record<string, unknown>): RepositoryResult<DeurRecord> {
  const base = mapCanonicalRow<Record<string, unknown>>(row); if (!base.success) return base;
  const eventRows = Array.isArray(row.deur_events) ? row.deur_events : [];
  const events = eventRows.flatMap((value): CanonicalDeurEvent[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const event = value as Record<string, unknown>;
    if (typeof event.id !== "string" || typeof event.activity_type !== "string" || typeof event.action !== "string" || typeof event.occurred_at !== "string" || typeof event.sequence !== "number") return [];
    return [{ id:event.id, activityType:event.activity_type as CanonicalDeurEvent["activityType"], action:event.action as CanonicalDeurEvent["action"], timestamp:event.occurred_at, sequence:event.sequence, source:event.source === "legacy" ? "legacy" : event.source === "automatic" ? "automatic" : "user", actorId:typeof event.actor_id === "string" ? event.actor_id : undefined, deurId:typeof event.deur_id === "string" ? event.deur_id : undefined, idleReasonId:typeof event.idle_reason_id === "string" ? event.idle_reason_id : undefined, idleReasonLabelSnapshot:typeof event.idle_reason_label_snapshot === "string" ? event.idle_reason_label_snapshot : undefined, idleReasonRemarks:typeof event.idle_reason_remarks === "string" ? event.idle_reason_remarks : undefined }];
  }).sort((left,right)=>left.sequence-right.sequence);
  const logs = Array.isArray(base.value.logs) ? base.value.logs : [];
  return repositorySuccess({ ...base.value, events, logs } as unknown as DeurRecord);
}
export function mapBillingStatement(row: Record<string, unknown>): RepositoryResult<BillingStatement> {
  const base = mapCanonicalRow<Record<string, unknown>>(row); if (!base.success) return base;
  const lineRows = Array.isArray(row.billing_statement_lines) ? row.billing_statement_lines : [];
  const lines = lineRows.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const mapped = mapCanonicalRow<Record<string, unknown>>(value);
    if (!mapped.success) return [];
    const line = mapped.value;
    return [{
      ...line,
      costCode: line.costCodeSnapshot ?? "",
      activityCode: line.activityCodeSnapshot,
      amount: line.amount,
    } as unknown as BillingStatement["lines"][number]];
  });
  const value = base.value;
  return repositorySuccess({
    ...value,
    version: value.rowVersion ?? value.statementVersion,
    equipmentId: value.legacyEquipmentId ?? lines[0]?.equipmentId ?? "",
    operatorId: value.legacyOperatorId ?? lines[0]?.operatorId ?? "",
    customer: value.customerSnapshot ?? "",
    project: value.projectSnapshot ?? "",
    lines,
  } as unknown as BillingStatement);
}
export function mapCustomer(row: Record<string, unknown>): RepositoryResult<CustomerRecord> {
  const base = mapCanonicalRow<Record<string, unknown>>(row);
  if (!base.success) return base;
  const value = base.value;
  if (typeof value.customerCode !== "string" || typeof value.name !== "string" || typeof value.active !== "boolean") return repositoryFailure("REMOTE_ROW_MALFORMED", "Remote Customer requires code, name, and active state.", { context: { repository: "Customer" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical Customer row." });
  const optional = (item: unknown) => typeof item === "string" && item ? item : undefined;
  return repositorySuccess({ id: String(value.id), customerCode: value.customerCode, companyName: value.name, contactNumber: optional(value.phone), email: optional(value.email), address: optional(value.address), active: value.active } as CustomerRecord);
}
export function mapProject(row: Record<string, unknown>): RepositoryResult<ProjectRecord> {
  const base = mapCanonicalRow<Record<string, unknown>>(row);
  if (!base.success) return base;
  const value = base.value;
  if (typeof value.id !== "string" || typeof value.projectCode !== "string" || typeof value.name !== "string" || typeof value.active !== "boolean") return repositoryFailure("REMOTE_ROW_MALFORMED", "Remote Project requires id, code, name, and active state.", { context: { repository: "Project" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical Project row." });
  return repositorySuccess({ id: value.id, projectCode: value.projectCode, projectName: value.name, customerId: typeof value.customerId === "string" ? value.customerId : undefined, location: typeof value.location === "string" ? value.location : "", projectManager: "", status: value.active ? "Active" : "Completed", deleted: value.deletedAt !== null && value.deletedAt !== undefined, rowVersion: typeof value.rowVersion === "number" ? value.rowVersion : undefined } as ProjectRecord);
}
function mapAssignment(row: Record<string, unknown>): RepositoryResult<AssignmentRecord> {
  const base = mapCanonicalRow<Record<string, unknown>>(row);
  if (!base.success) return base;
  const { expectedReturn, ...assignment } = base.value;
  return repositorySuccess({
    ...assignment,
    ...(typeof expectedReturn === "string" && expectedReturn ? { expectedReturn } : {}),
  } as unknown as AssignmentRecord);
}
export function mapRental(row: Record<string, unknown>): RepositoryResult<RentalRecord> {
  const base = mapCanonicalRow<Record<string, unknown>>(row);
  if (!base.success) return base;
  const approvalRequester = base.value.approvalRequestedBy;
  const frequency = base.value.deurExpectationFrequency;
  const effectiveFrom = base.value.deurExpectationEffectiveFrom;
  const capturedAt = base.value.deurExpectationCapturedAt;
  const deurExpectationPolicy = typeof frequency === "string" && typeof effectiveFrom === "string" && typeof capturedAt === "string"
    ? {
        frequency,
        effectiveFrom,
        ...(typeof base.value.deurExpectationEffectiveUntil === "string" ? { effectiveUntil: base.value.deurExpectationEffectiveUntil } : {}),
        ...(Array.isArray(base.value.expectedShiftCodes) ? { expectedShiftCodes: base.value.expectedShiftCodes } : {}),
        ...(Array.isArray(base.value.excludedDates) ? { excludeDates: base.value.excludedDates } : {}),
        ...(typeof base.value.timezone === "string" ? { timezone: base.value.timezone } : {}),
        capturedAt,
      }
    : undefined;
  return repositorySuccess({
    ...base.value,
    ...(deurExpectationPolicy ? { deurExpectationPolicy } : {}),
    ...(typeof base.value.deurExpectationFrozenAt === "string" ? { deurExpectationPolicyFrozenAt: base.value.deurExpectationFrozenAt } : {}),
    ...(typeof approvalRequester === "string"
      ? { approvalRequestedBy: undefined, approvalRequestedById: approvalRequester }
      : approvalRequester && typeof approvalRequester === "object" && typeof (approvalRequester as Record<string, unknown>).id === "string"
        ? { approvalRequestedById: (approvalRequester as Record<string, unknown>).id as string }
        : {}),
    customer: base.value.customer ?? base.value.customerSnapshot ?? "",
    project: base.value.project ?? base.value.projectSnapshot ?? "",
  } as unknown as RentalRecord);
}
export function mapRentalEquipmentLine(row: Record<string, unknown>): RepositoryResult<RentalEquipmentLine> {
  const base = mapCanonicalRow<Record<string, unknown>>(row);
  if (!base.success) return base;
  const metadata = base.value.operationalMetadata;
  const deurExpectationSnapshot = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).deurExpectationSnapshot
    : undefined;
  return repositorySuccess({
    ...base.value,
    ...(deurExpectationSnapshot && typeof deurExpectationSnapshot === "object" && !Array.isArray(deurExpectationSnapshot)
      ? { deurExpectationSnapshot }
      : {}),
  } as unknown as RentalEquipmentLine);
}
function mapUser(row: Record<string, unknown>): RepositoryResult<User> {
  const base = mapCanonicalRow<Record<string, unknown>>(row); if (!base.success) return base;
  if (typeof base.value.username !== "string" || typeof base.value.displayName !== "string") return repositoryFailure("REMOTE_ROW_MALFORMED", "Remote User requires username and display name.", { context: { repository: "User" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the remote User profile." });
  const roleRows = Array.isArray(row.user_roles) ? row.user_roles : [];
  const systemRoles = roleRows.flatMap((entry) => { const role = entry && typeof entry === "object" ? (entry as Record<string, unknown>).app_roles : undefined; const code = role && typeof role === "object" ? (role as Record<string, unknown>).code : undefined; return typeof code === "string" ? [code] : []; });
  const credentialMode = row.credential_mode === "OPERATOR_PIN" ? "OPERATOR_PIN" : "PASSWORD";
  return repositorySuccess({ ...base.value, credentialMode, systemRoles } as unknown as User);
}
