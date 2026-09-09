import type { RentalBillingMethod, RentalType, TransactionRelationship, VatApplicability } from "@/features/rental/types";

export interface CanonicalRentalContract {
  id: string; rentalId: string; rentalEquipmentLineId: string; contractNo: string;
  billingMethod: RentalBillingMethod; currency: string; unitRate: number;
  minimumBillableHours?: number; overtimeRate?: number; standbyRate?: number;
  mobilizationFee?: number; demobilizationFee?: number; fuelCharge?: number;
  operatorIncluded: boolean; operatorRate?: number; contractAmount?: number;
  taxRate?: number; withholdingTax?: number; transactionRelationship?: TransactionRelationship;
  vatApplicability?: VatApplicability; remarks?: string; startDate: string;
  expectedEndDate: string; status: "Draft" | "Active"; rowVersion: number;
}
export interface CanonicalCommercialSnapshot extends Omit<CanonicalRentalContract, "contractNo" | "remarks" | "startDate" | "expectedEndDate" | "status" | "rowVersion"> {
  sourceContractId: string; capturedAt: string;
}
export interface CanonicalReferenceCode { id: string; code: string; name: string; active: boolean; sortOrder: number }
export interface DeurExpectationDisposition { id:string; rentalId:string; rentalEquipmentLineId:string; workDate:string; expectationFingerprint:string; disposition:"WAIVED"; reason:string; createdAt:string; createdBy:string }
export interface CanonicalRentalWorkspace { rentalId: string; contracts: CanonicalRentalContract[]; commercialSnapshots: CanonicalCommercialSnapshot[]; expectationDispositions?: DeurExpectationDisposition[] }
export interface CanonicalRentalReferenceData { costCodes: CanonicalReferenceCode[]; activityCodes: CanonicalReferenceCode[] }
export interface CanonicalRentalReleaseReadinessLine { rentalEquipmentLineId: string; equipmentId?: string; missingFields: string[]; invalidValues: string[]; reasonCode?: string }
export interface CanonicalRentalReleaseReadiness { rentalId: string; eligible: boolean; reasonCodes: string[]; incompleteEquipmentLines: CanonicalRentalReleaseReadinessLine[] }
export interface CanonicalRentalReturnEvidence { rental:{id:string;number:string;status:string;version:number}; line:{id:string;status:string;actualReturnDate:string|null;equipmentId:string}; assignment:{id:string;status:string;returnedDate:string|null}|null; availability:{onReturnDate:unknown[]|null;onNextDate:unknown[]|null} }

export type CanonicalDraftValidationReason = "INVALID_COMMAND" | "INVALID_CONTACT" | "INVALID_LINE_SET" | "INVALID_DATE" | "INVALID_IDEMPOTENCY_STATE" | "INVALID_LINE_SHAPE";
export type CanonicalRentalFailureCode = "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION_REJECTED" | "NOT_FOUND" | "MISSING_RELATIONSHIP" | "EQUIPMENT_UNAVAILABLE" | "EQUIPMENT_INTERVAL_CONFLICT" | "RENTAL_NUMBER_CONFLICT" | "RENTAL_CONFLICT" | "CONFLICT" | "LINE_SET_MISMATCH" | "INVALID_TRANSITION" | "RELEASE_NOT_READY" | "IDEMPOTENCY_MISMATCH" | "EXPECTATION_NOT_WAIVABLE" | "EXPECTATION_HAS_DEUR" | "ALREADY_WAIVED" | "PERSISTENCE_FAILURE" | "TRANSPORT_FAILURE" | "INVALID_RESPONSE";
export type CanonicalReadResult<T> = { success: true; value: T } | { success: false; code: CanonicalRentalFailureCode; message: string };
export interface CanonicalCommandValue { rentalId: string; rentalNumber?: string; status: string; approvalStatus?: string; version: number; lineIds?: string[] }
export type CanonicalCommandResult = { success: true; disposition: "ACCEPTED" | "REPLAYED"; value: CanonicalCommandValue } | { success: false; code: CanonicalRentalFailureCode; message: string; details?: unknown; currentVersion?: number };

export interface CreateCanonicalDraftInput { commandId: string; idempotencyKey: string; customerId: string; projectId: string; dateOut: string; expectedReturn?: string; rentalType: RentalType; representativeName: string; representativeEmail: string; lines: { assignmentId: string }[] }
export interface CanonicalTermsInput { billingMethod: RentalBillingMethod; currency: string; unitRate: number; minimumBillableHours?: number; overtimeRate?: number; standbyRate?: number; mobilizationFee?: number; demobilizationFee?: number; fuelCharge?: number; operatorIncluded: boolean; operatorRate?: number; contractAmount?: number; taxRate?: number; withholdingTax?: number; transactionRelationship?: TransactionRelationship; vatApplicability?: VatApplicability; remarks?: string }
export interface UpdateCanonicalTermsInput { commandId: string; idempotencyKey: string; rentalId: string; expectedVersion: number; lines: { lineId: string; commercialTerms: CanonicalTermsInput; costCodeId: string; activityCodeId: string; workDescriptionId: string; deurPolicy: Record<string, unknown>; operationalRemarks?: string; shiftWindows?: unknown[]; workDate?: string; meterRequirement?: string }[] }
export interface CanonicalVersionedInput { commandId: string; idempotencyKey: string; rentalId: string; expectedVersion: number }
export interface DecideCanonicalApprovalInput extends CanonicalVersionedInput { decision: "Approved" | "Rejected"; remarks?: string }
export interface ConfigureCanonicalCustomerReviewInput extends CanonicalVersionedInput { customerId: string; representativeName: string; representativeEmail: string }
export interface WaiveDeurExpectationInput { commandId:string; idempotencyKey:string; rentalId:string; rentalEquipmentLineId:string; workDate:string; expectationFingerprint:string; reason:string }

export interface CanonicalRentalRemoteRepository {
  readWorkspace(rentalId: string): Promise<CanonicalReadResult<CanonicalRentalWorkspace>>;
  readReferenceData(): Promise<CanonicalReadResult<CanonicalRentalReferenceData>>;
  getReleaseReadiness(rentalId: string): Promise<CanonicalReadResult<CanonicalRentalReleaseReadiness>>;
  readReturnEvidence(rentalId: string, rentalEquipmentLineId: string): Promise<CanonicalReadResult<CanonicalRentalReturnEvidence>>;
  createDraft(input: CreateCanonicalDraftInput): Promise<CanonicalCommandResult>;
  updateTerms(input: UpdateCanonicalTermsInput): Promise<CanonicalCommandResult>;
  submitApproval(input: CanonicalVersionedInput): Promise<CanonicalCommandResult>;
  decideApproval(input: DecideCanonicalApprovalInput): Promise<CanonicalCommandResult>;
  reserve(input: CanonicalVersionedInput): Promise<CanonicalCommandResult>;
  release(input: CanonicalVersionedInput): Promise<CanonicalCommandResult>;
  activate(input: CanonicalVersionedInput): Promise<CanonicalCommandResult>;
  configureCustomerReview?(input: ConfigureCanonicalCustomerReviewInput): Promise<CanonicalCommandResult>;
  waiveDeurExpectation?(input: WaiveDeurExpectationInput): Promise<CanonicalCommandResult>;
}
