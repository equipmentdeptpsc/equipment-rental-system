export type OperationalCommandFailureCode =
  | "NOT_ENABLED"
  | "UNAUTHENTICATED" | "UNAUTHORIZED" | "FORBIDDEN" | "TENANT_MISMATCH"
  | "OWNERSHIP_MISMATCH" | "NOT_FOUND" | "INVALID_TOKEN" | "ALREADY_COMPLETED"
  | "INVALID_TRANSITION" | "VALIDATION_REJECTED" | "CONFLICT"
  | "CUSTOMER_INVALID" | "PROJECT_CODE_CONFLICT" | "OPERATOR_ID_CONFLICT" | "ASSET_NUMBER_CONFLICT" | "EQUIPMENT_ID_CONFLICT"
  | "IDEMPOTENCY_MISMATCH" | "EQUIPMENT_UNAVAILABLE" | "RENTAL_CONFLICT"
  | "MISSING_RELATIONSHIP" | "CANCELLATION_NOT_ALLOWED" | "CUSTOMER_RELINK_NOT_ALLOWED"
  | "BILLING_INELIGIBLE" | "DUPLICATE_CONSUMPTION" | "UNSUPPORTED_BILLING_METHOD"
  | "RECOVERY_NOT_ALLOWED" | "DOWNSTREAM_EVIDENCE_EXISTS" | "ALREADY_REVERSED"
  | "TRANSPORT_FAILURE" | "PERSISTENCE_FAILURE";

export interface OperationalCommandMetadata {
  commandId: string;
  idempotencyKey: string;
  expectedVersion?: number;
  clientCreatedAt?: string;
  deviceId?: string;
}

export type OperationalCommandResult<T> =
  | { success: true; disposition: "ACCEPTED" | "REPLAYED" | "ALREADY_COMPLETED"; value: T; serverOccurredAt: string; refresh: readonly string[] }
  | { success: false; code: OperationalCommandFailureCode; message: string; retryable: boolean; refreshRequired: boolean; currentVersion?: number };

export interface CreateCustomerReviewRequestInput extends OperationalCommandMetadata {
  deurId: string; rentalLineId: string; revisionId: string;
}
export interface CustomerReviewRequestResult {
  requestId: string; deurId: string; rentalLineId: string; revisionId: string;
  expiresAt: string; rawToken?: string;
}
export interface PublicReviewDecisionInput {
  commandId: string; idempotencyKey: string; token: string; customerName: string; comment?: string;
}
export interface PublicReviewConfirmation { requestId: string; status: "Acknowledged" | "Rejected" }

export interface CustomerReviewCommandRepository {
  createRequest(input: CreateCustomerReviewRequestInput): Promise<OperationalCommandResult<CustomerReviewRequestResult>>;
  acknowledge(input: PublicReviewDecisionInput): Promise<OperationalCommandResult<PublicReviewConfirmation>>;
  reject(input: PublicReviewDecisionInput & { comment: string }): Promise<OperationalCommandResult<PublicReviewConfirmation>>;
}

export interface CreateDeurRevisionInput extends OperationalCommandMetadata {
  deurId: string; sourceRevisionId: string; changes: Readonly<Record<string, unknown>>;
  reasonCode: string; reasonDetails?: string;
}
export interface DeurRevisionResult { deurId: string; sourceRevisionId: string; revisionId: string; revisionNumber: number; version: number }
export interface DeurRevisionCommandRepository {
  createCorrection(input: CreateDeurRevisionInput): Promise<OperationalCommandResult<DeurRevisionResult>>;
}

export interface RecordMeterCheckpointInput extends OperationalCommandMetadata {
  deurId: string; rentalLineId: string; equipmentId: string;
  kind: "opening" | "closing" | "checkpoint"; reading: number;
  clientOccurredAt?: string; location?: { latitude: number; longitude: number };
}
export interface MeterCheckpointResult { checkpointId: string; deurId: string; version: number }
export interface MeterCheckpointCommandRepository {
  record(input: RecordMeterCheckpointInput): Promise<OperationalCommandResult<MeterCheckpointResult>>;
}

export interface ReturnRentalLineInput extends OperationalCommandMetadata {
  rentalId: string; rentalLineId: string; equipmentId: string; assignmentId?: string; actualReturnDate: string;
}
export interface ReturnAllRentalLinesInput extends OperationalCommandMetadata { rentalId: string; actualReturnDate: string }
export interface RentalLineReturnProjection { rentalId: string; rentalLineId: string; status: string; version: number; actualReturnDate?: string }
export interface ReturnAllProjection { rentalId: string; lines: readonly RentalLineReturnProjection[]; version: number }
export interface RentalReturnReadiness { rentalId: string; ready: boolean; historicalBoundary: string; blockers: readonly { code: string; message: string; rentalLineId: string; workDate: string; shiftCode?: string }[] }
export interface RentalReturnCommandRepository {
  returnLine(input: ReturnRentalLineInput): Promise<OperationalCommandResult<RentalLineReturnProjection>>;
  returnAll(input: ReturnAllRentalLinesInput): Promise<OperationalCommandResult<ReturnAllProjection>>;
  getReturnReadiness(input: { rentalId: string }): Promise<OperationalCommandResult<RentalReturnReadiness>>;
}

export interface RentalClosureReadinessInput { rentalId: string }
export interface RentalClosureBlocker { code: string; message: string; rentalLineId?: string }
export interface RentalClosureReadiness {
  rentalId: string; ready: boolean;
  lines: readonly { rentalLineId: string; ready: boolean; blockers: readonly RentalClosureBlocker[] }[];
  blockers: readonly RentalClosureBlocker[];
}
export interface CloseRentalInput extends OperationalCommandMetadata { rentalId: string }
export interface RentalClosureProjection { rentalId: string; status: "Closed"; version: number; closedAt: string }
export interface RentalClosureCommandRepository {
  getReadiness(input: RentalClosureReadinessInput): Promise<OperationalCommandResult<RentalClosureReadiness>>;
  close(input: CloseRentalInput): Promise<OperationalCommandResult<RentalClosureProjection>>;
}

export interface RentalLifecycleLineInput {
  id: string; equipmentId: string; assignmentId: string; operatorId: string;
}
export interface CreateReservedRentalInput extends OperationalCommandMetadata {
  rentalId: string; rentalNumber: string; customerId: string; projectId: string;
  dateOut: string; expectedReturn?: string; rentalType: "Bare Rental" | "Operated Rental";
  lines: readonly RentalLifecycleLineInput[];
}
export interface RentalLifecycleTransitionInput extends OperationalCommandMetadata { rentalId: string }
export interface RentalLifecycleProjection {
  rentalId: string; rentalNumber?: string;
  status: "Reserved" | "Released" | "Active" | "Cancelled"; version: number;
}
export interface RentalLifecycleCommandRepository {
  createReserved(input: CreateReservedRentalInput): Promise<OperationalCommandResult<RentalLifecycleProjection>>;
  release(input: RentalLifecycleTransitionInput): Promise<OperationalCommandResult<RentalLifecycleProjection>>;
  activate(input: RentalLifecycleTransitionInput): Promise<OperationalCommandResult<RentalLifecycleProjection>>;
  cancel(input: RentalLifecycleTransitionInput): Promise<OperationalCommandResult<RentalLifecycleProjection>>;
}

export interface BillingCommandInput extends OperationalCommandMetadata { statementId: string }
export interface GenerateBillingEvidenceInput extends OperationalCommandMetadata { deurId: string }
export interface ConsumeDeurInput extends OperationalCommandMetadata {
  statementId: string; deurId: string; lineId?: string; description?: string;
}
export interface CreateBillingStatementInput extends OperationalCommandMetadata {
  statementId: string; rentalId: string; billingFrom: string; billingTo: string; currency?: string;
}
export interface UpdateInvoiceInput extends BillingCommandInput {
  invoiceStatus: "Partially Collected" | "Fully Collected";
}
export interface BillingEvidenceProjection {
  deurId: string; rentalId: string; rentalLineId?: string; equipmentId: string; operatorId: string;
  workDate: string; billingMethod: string; quantity: number; unit: string; unitRate: number;
  hours: number; hourlyRate: number; subtotal: number; vat: number; withholdingTax: number; grandTotal: number;
}
export interface BillingConsumptionProjection {
  statementId: string; lineId: string; deurId: string; statementVersion: number; deurVersion: number;
}
export interface BillingLifecycleProjection {
  statementId: string; statementNumber?: string; invoiceNumber?: string;
  approvalStatus: BillingApprovalStatus; invoiceStatus: BillingInvoiceStatus; version: number;
}
export type BillingApprovalStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected";
export type BillingInvoiceStatus = "Not Invoiced" | "Invoiced" | "Partially Collected" | "Fully Collected" | "Cancelled";
export interface BillingFinancialCommandRepository {
  generateEvidence(input: GenerateBillingEvidenceInput): Promise<OperationalCommandResult<BillingEvidenceProjection>>;
  createStatement(input: CreateBillingStatementInput): Promise<OperationalCommandResult<BillingLifecycleProjection>>;
  consumeDeur(input: ConsumeDeurInput): Promise<OperationalCommandResult<BillingConsumptionProjection>>;
  finalizeStatement(input: BillingCommandInput): Promise<OperationalCommandResult<BillingLifecycleProjection>>;
  createInvoice(input: BillingCommandInput): Promise<OperationalCommandResult<BillingLifecycleProjection>>;
  updateInvoice(input: UpdateInvoiceInput): Promise<OperationalCommandResult<BillingLifecycleProjection>>;
}

export interface RecoveryCommandMetadata extends OperationalCommandMetadata {
  reason: string;
  originalReference?: string;
}
export interface RentalRecoveryInput extends RecoveryCommandMetadata { rentalId: string }
export interface FinancialRecoveryInput extends RecoveryCommandMetadata { statementId: string }
export interface DeurConsumptionRecoveryInput extends FinancialRecoveryInput { deurId: string }
export interface RecoveryProjection {
  recoveryId: string;
  targetId: string;
  action: "REOPEN" | "REVERSE_RETURN" | "VOID" | "RELEASE" | "CANCEL";
  status: string;
  version: number;
}
export interface RecoveryCommandRepository {
  reopenRental(input: RentalRecoveryInput): Promise<OperationalCommandResult<RecoveryProjection>>;
  reverseRentalReturn(input: RentalRecoveryInput): Promise<OperationalCommandResult<RecoveryProjection>>;
  voidBillingStatement(input: FinancialRecoveryInput): Promise<OperationalCommandResult<RecoveryProjection>>;
  releaseDeurConsumption(input: DeurConsumptionRecoveryInput): Promise<OperationalCommandResult<RecoveryProjection>>;
  cancelInvoice(input: FinancialRecoveryInput): Promise<OperationalCommandResult<RecoveryProjection>>;
}

export interface OperationalCommandRepositories {
  customerReviewCommands: CustomerReviewCommandRepository;
  deurRevisionCommands: DeurRevisionCommandRepository;
  meterCheckpointCommands: MeterCheckpointCommandRepository;
  rentalReturnCommands: RentalReturnCommandRepository;
  rentalClosureCommands: RentalClosureCommandRepository;
  rentalLifecycleCommands: RentalLifecycleCommandRepository;
  billingFinancialCommands: BillingFinancialCommandRepository;
  recoveryCommands: RecoveryCommandRepository;
}

export function isOperationalCommandResult<T>(value: unknown): value is OperationalCommandResult<T> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.success === true) {
    return ["ACCEPTED", "REPLAYED", "ALREADY_COMPLETED"].includes(String(candidate.disposition)) &&
      typeof candidate.serverOccurredAt === "string" && Array.isArray(candidate.refresh) && "value" in candidate;
  }
  return candidate.success === false && typeof candidate.code === "string" &&
    typeof candidate.message === "string" && typeof candidate.retryable === "boolean" &&
    typeof candidate.refreshRequired === "boolean";
}
