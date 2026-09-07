import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  RentalLifecycleStatus,
  RentalRecord,
} from "../types";
import type { RentalContractRecord } from "../types/RentalContract";

import {
  getRentalCommercialTermsError,
  validateRentalBillingTerms,
  normalizeRentalBillingTermsInput,
  getRentalTransitionError,
  isEquipmentBlockingRental,
} from "../services/RentalWorkflowRules";
import { validateNewRentalDates } from "../utils/rentalDateValidation";

import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useAuth } from "@/features/auth/AuthContext";
import { useAudit } from "@/features/equipment/audit/AuditContext";
import {
  createHistoryEvent,
  useEquipmentHistory,
} from "@/features/equipment/history";
import { createRentalOperationalMetadataSnapshot } from "../services/createRentalOperationalMetadataSnapshot";
import { canEditRentalCommercialTerms, configureBulkRentalCommercialTerms, configureRentalCommercialTerms, type RentalCommercialTermsInput } from "../services/configureRentalCommercialTerms";
import { prepareRentalEquipmentLineRelease, type RentalEquipmentLineReleaseIssue } from "../services/prepareRentalEquipmentLineRelease";
import { freezeRentalDeurExpectationPolicy } from "../deur/expectation/freezeRentalDeurExpectationPolicy";
import { type NewRentalEquipmentLineInput, type RentalEquipmentLine, type RentalEquipmentLineIssue, type RentalEquipmentLineMigrationIssue } from "../equipment-line";
import { canRemoveRentalEquipmentLine, validateRentalEquipmentLineInputs } from "../services/manageRentalEquipmentLines";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { decideRentalApproval, getRentalApprovalStatus, invalidateRentalApproval, submitRentalApproval } from "../approval/rentalApproval";
import { rentalAuditRepository } from "../audit/rentalAuditRepository";
import { buildManagerApprovalEmailSnapshot } from "../approval-email/buildManagerApprovalEmailSnapshot";
import { developmentApprovalEmailOutbox } from "../approval-email/developmentApprovalEmailOutbox";
import { resolveActiveManagerApprover } from "@/features/settings/manager-approver/managerApproverService";
import { developmentCustomerReviewOutbox } from "../customer-review/developmentCustomerReviewOutbox";
import { maskEmail, updateRentalCustomerContact, type RentalCustomerContactInput } from "../services/updateRentalCustomerContact";
import { returnRentalEquipmentLine as returnEquipmentLine } from "../services/returnRentalEquipmentLine";
import { notifyRentalWorkspaceChange } from "../workspace/workspaceRefresh";
import { workDescriptionRepository } from "@/features/masters/work-description/repository";
import { evaluateRentalReleaseReadiness, regenerateRentalLineDeurExpectation, type RentalReleaseReadinessResult } from "../services/evaluateRentalReleaseReadiness";
import { validateRentalLineIdentityIntegrity } from "../services/validateRentalLineIdentityIntegrity";
import { buildCloseReadiness } from "../workspace/closing/CloseReadinessBuilder";
import { buildRentalAggregate } from "../aggregate";
import { collectionRepository } from "../collections/repository";
import { reconcileStatementCollections } from "../collections/collectionService";
import { isInvoicePreparationComplete } from "../billingstatement/services/BillingReadiness";
import { resolveRentalStatusAfterLineReturn } from "../services/resolveRentalStatusAfterLineReturn";
import { canUseLegacyRentalMutations, REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE } from "../services/rentalRuntimeCapability";

const releaseFieldMessage = (field: string) => field === "deurPolicy" ? "DEUR expectation policy" : field === "operationalMetadata" ? "operational metadata snapshot" : field === "snapshotFreshness" ? "stale DEUR release snapshot" : field === "snapshot" ? "persisted DEUR release snapshot" : field === "billingTerms" ? "commercial terms" : field;

interface RentalTransitionResult {
  success: boolean;
  message?: string;
  rental?: RentalRecord;
  issues?: RentalEquipmentLineReleaseIssue[];
}

interface RentalContextType {
  rentals: RentalRecord[];

  addRental(
    item: Omit<RentalRecord, "status" | "statusId">,
    equipmentLines?: NewRentalEquipmentLineInput[],
  ): {
    success: boolean;
    message?: string;
  };

  updateRental(item: RentalRecord): void;
  updateCustomerContact(id:string,input:RentalCustomerContactInput):RentalTransitionResult;

  transitionRental(
    id: string,
    nextStatus: RentalLifecycleStatus
  ): RentalTransitionResult;

  deleteRental(id: string): RentalTransitionResult;

  returnRental(id: string): RentalTransitionResult;
  returnRentalEquipmentLine(rentalId: string, lineId: string): RentalTransitionResult;

  releaseRental(
    id: string,
    releasedBy: string
  ): RentalTransitionResult;

  submitForApproval(id: string): RentalTransitionResult;
  approveRental(id: string, remarks?: string): RentalTransitionResult;
  rejectRental(id: string, reason: string): RentalTransitionResult;

  getRental(id: string): RentalRecord | undefined;

  contracts: RentalContractRecord[];

  addContract(contract: RentalContractRecord): void;
  updateContract(contract: RentalContractRecord): void;
  deleteContract(id: string): void;
  getContract(id: string): RentalContractRecord | undefined;
  saveCommercialTerms(id: string, input: RentalCommercialTermsInput): RentalTransitionResult;
  getContractForRentalEquipmentLine(lineId: string): RentalContractRecord | undefined;
  saveCommercialTermsForRentalEquipmentLine(rentalId: string, lineId: string, input: RentalCommercialTermsInput): RentalTransitionResult;
  saveCommercialTermsForSelectedLines(rentalId: string, lineIds: string[], input: RentalCommercialTermsInput): RentalTransitionResult;
  rentalEquipmentLines: RentalEquipmentLine[];
  rentalEquipmentLineMigrationIssues: RentalEquipmentLineMigrationIssue[];
  addRentalEquipmentLine(rentalId: string, input: NewRentalEquipmentLineInput): { success: boolean; message?: string; issues?: RentalEquipmentLineIssue[] };
  removeRentalEquipmentLine(rentalId: string, lineId: string): { success: boolean; message?: string; issues?: RentalEquipmentLineIssue[] };
  getReleaseReadiness(rentalId: string): RentalReleaseReadinessResult;
  configureLineDeurExpectation(rentalId: string, lineId: string, workDescriptionId: string, remarks?: string): RentalTransitionResult;
}

const RentalContext =
  createContext<RentalContextType | undefined>(undefined);

export function RentalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const dependencies = useApplicationDependenciesCompatibility();
  const { rental: rentalRepository, rentalContract: rentalContractRepository, rentalEquipmentLine: rentalEquipmentLineRepository, deur: deurRepository, billingStatement: billingStatementRepository, costCode: costCodeRepository, activityCode: activityCodeRepository, deurShiftWindow: deurShiftWindowRepository } = dependencies.repositories;
  const legacyMutationsEnabled = canUseLegacyRentalMutations(dependencies.configuration);
  const unavailable = () => ({ success: false as const, message: REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE });
  const [bootstrap] = useState(() => {
    const initialRentals = rentalRepository.getAll();
    const lineCompatibility = rentalEquipmentLineRepository.ensureCompatibility(initialRentals);
    const contractCompatibility = rentalContractRepository.ensureLineAssociations(lineCompatibility.lines);
    return {
      rentals: initialRentals,
      lines: lineCompatibility.lines,
      contracts: contractCompatibility.contracts,
      issues: [...lineCompatibility.issues, ...contractCompatibility.issues],
    };
  });
  const [rentals, setRentals] =
    useState<RentalRecord[]>(bootstrap.rentals);
  const [contracts, setContracts] =
    useState<RentalContractRecord[]>(bootstrap.contracts);
  const [rentalEquipmentLines, setRentalEquipmentLines] = useState<RentalEquipmentLine[]>(bootstrap.lines);
  const [rentalEquipmentLineMigrationIssues, setRentalEquipmentLineMigrationIssues] = useState<RentalEquipmentLineMigrationIssue[]>(bootstrap.issues);

  const { equipment: equipmentRecords, getEquipment, updateEquipment } = useEquipment();
  const { user, hasPermission } = useAuth();
  const { assignments, getAssignment, completeAssignment } = useAssignment();
  const { operators } = useOperator();
  const { projects } = useProject();
  const workDescriptions = workDescriptionRepository.getAll();
  const { logAction } = useAudit();
  const { log } = useEquipmentHistory();

  function refreshRentals() {
    setRentals([...rentalRepository.getAll()]);
  }

  function refreshContracts() {
    const compatibility = rentalContractRepository.ensureLineAssociations(rentalEquipmentLineRepository.getAll());
    setContracts([...compatibility.contracts]);
    if (compatibility.issues.length) setRentalEquipmentLineMigrationIssues((current) => [...current, ...compatibility.issues]);
  }

  function refreshRentalEquipmentLines() {
    const lineCompatibility = rentalEquipmentLineRepository.ensureCompatibility(rentalRepository.getAll());
    const contractCompatibility = rentalContractRepository.ensureLineAssociations(lineCompatibility.lines);
    setRentalEquipmentLines([...lineCompatibility.lines]);
    setContracts([...contractCompatibility.contracts]);
    setRentalEquipmentLineMigrationIssues([...lineCompatibility.issues, ...contractCompatibility.issues]);
  }

  function releaseReadiness(rental: RentalRecord, timestamp = new Date().toISOString()) {
    const compatible = rentalEquipmentLineRepository.ensureCompatibility(rentalRepository.getAll());
    return evaluateRentalReleaseReadiness({
      rental,
      lines: compatible.lines,
      assignments,
      operators,
      equipment: equipmentRecords,
      projects,
      contracts: rentalContractRepository.ensureLineAssociations(compatible.lines).contracts,
      workDescriptions,
      shiftWindows: deurShiftWindowRepository.getAll(),
      timestamp,
    });
  }

  function getReleaseReadiness(rentalId: string): RentalReleaseReadinessResult {
    const rental = rentalRepository.getById(rentalId);
    return rental ? releaseReadiness(rental) : { eligible: false, reasonCodes: ["RELEASE_NOT_READY", "NO_ACTIVE_LINES"], rentalId, incompleteEquipmentLines: [], lines: [] };
  }

  function configureLineDeurExpectation(rentalId: string, lineId: string, workDescriptionId: string, remarks?: string): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.manage")) return { success: false, message: "You do not have permission to configure Rental DEUR expectations." };
    const rental = rentalRepository.getById(rentalId);
    const line = rentalEquipmentLineRepository.getById(lineId);
    if (!rental || !line || line.rentalId !== rentalId) return { success: false, message: "Rental equipment line was not found." };
    if (!["Draft", "Assigned", "Reserved"].includes(rental.status) || rental.deurExpectationPolicyFrozenAt) return { success: false, message: "DEUR expectations are immutable after Rental release." };
    const configured = { ...line, deurWorkDescriptionId: workDescriptionId.trim(), ...(remarks?.trim() ? { deurOperationalRemarks: remarks.trim() } : { deurOperationalRemarks: undefined }), deurExpectationSnapshot: undefined, updatedAt: new Date().toISOString() };
    const compatible = rentalEquipmentLineRepository.getAll().map((item) => item.id === lineId ? configured : item);
    const readiness = regenerateRentalLineDeurExpectation({ rental, lines: compatible, assignments, operators, equipment: equipmentRecords, projects, contracts: rentalContractRepository.ensureLineAssociations(compatible).contracts, workDescriptions, shiftWindows: deurShiftWindowRepository.getAll(), timestamp: configured.updatedAt }, lineId);
    if (!readiness.snapshot || readiness.missingFields.length) return { success: false, message: `DEUR expectation is incomplete: ${[...readiness.missingFields, ...readiness.invalidValues].join(", ")}.` };
    rentalEquipmentLineRepository.update({ ...configured, deurExpectationSnapshot: readiness.snapshot });
    refreshRentalEquipmentLines();
    return { success: true, rental };
  }

  function auditRental(previous: RentalRecord, resulting: RentalRecord, action: string, remarks?: string) {
    rentalAuditRepository.append({ id: crypto.randomUUID(), rentalId: previous.id, rentalNumber: previous.rentalNumber, action, timestamp: new Date().toISOString(), actorId: user?.id, actorName: user?.name, actorRole: user?.role, previousApprovalStatus: getRentalApprovalStatus(previous), resultingApprovalStatus: getRentalApprovalStatus(resulting), previousRentalStatus: previous.status, resultingRentalStatus: resulting.status, ...(remarks?.trim() ? { remarks: remarks.trim() } : {}) });
  }

  function invalidateApprovedRental(rentalId: string, reason: string) {
    const current = rentalRepository.getById(rentalId);
    if (!current) return;
    const invalidated = invalidateRentalApproval(current, user, reason, new Date().toISOString());
    if (!invalidated.event) return;
    rentalRepository.update(invalidated.rental);
    auditRental(current, invalidated.rental, "APPROVAL_INVALIDATED", reason);
    refreshRentals();
  }

  function blockingEquipmentIds(excludeRentalId?: string) {
    const blockingRentalIds = new Set(rentalRepository.getAll().filter((rental) => rental.id !== excludeRentalId && isEquipmentBlockingRental(rental)).map((rental) => rental.id));
    const ids = new Set(rentalEquipmentLineRepository.getAll().filter((line) => blockingRentalIds.has(line.rentalId)).map((line) => line.equipmentId));
    for (const rental of rentalRepository.getAll()) if (blockingRentalIds.has(rental.id) && rental.equipmentId) ids.add(rental.equipmentId);
    return ids;
  }

  function blockingOperatorIds(excludeRentalId?: string) {
    const blockingRentalIds = new Set(rentalRepository.getAll().filter((rental) => rental.id !== excludeRentalId && isEquipmentBlockingRental(rental)).map((rental) => rental.id));
    return new Set(rentalEquipmentLineRepository.getAll().filter((line) => blockingRentalIds.has(line.rentalId) && ["Released", "Active"].includes(line.status)).map((line) => line.operatorId));
  }

  function addRental(item: RentalRecord, equipmentLines?: NewRentalEquipmentLineInput[]) {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.manage")) return { success: false, message: "You do not have permission to manage Rentals." };
    const dateError = validateNewRentalDates(item.dateOut, item.expectedReturn);
    if (dateError) return { success: false, message: dateError };
    const commercialTermsError = getRentalCommercialTermsError(item);
    if (commercialTermsError) return { success: false, message: commercialTermsError };
    if (item.billingTerms || item.transactionRelationship) {
      const normalized = normalizeRentalBillingTermsInput(item);
      if (!normalized.valid) return { success: false, message: normalized.message };
      const terms = validateRentalBillingTerms({ ...item, billingTerms: normalized.value, transactionRelationship: normalized.transactionRelationship });
      if (!terms.valid) return { success: false, message: terms.message };
    }
    if (!item.rentalNumber?.trim()) {
      return {
        success: false,
        message: "Rental number is required.",
      };
    }

    if (!item.customerId?.trim() || !item.customer.trim()) {
      return {
        success: false,
        message: "Select a customer before creating a rental.",
      };
    }

    if (rentalRepository.getAll().some(
      (rental) => rental.rentalNumber === item.rentalNumber
    )) {
      return {
        success: false,
        message: "Rental number already exists.",
      };
    }

    const requestedLines = equipmentLines?.length ? equipmentLines : [{ equipmentId: item.equipmentId, assignmentId: item.assignmentId, operatorId: item.operatorId ?? "" }];
    if (!equipmentLines && !item.operatorId?.trim()) return { success: false, message: "Select an operator before creating a rental." };
    if (!equipmentLines && blockingEquipmentIds().has(item.equipmentId)) return { success: false, message: "Equipment already has a non-final rental." };
    const lineIssues = validateRentalEquipmentLineInputs({
      rental: { id: item.id, projectId: item.projectId, status: "Draft" }, requested: requestedLines, existingLines: [],
      assignments, equipment: equipmentRecords, blockingEquipmentIds: blockingEquipmentIds(), blockingOperatorIds: blockingOperatorIds(), requireAtLeastOne: true,
    });
    if (lineIssues.length) return { success: false, message: lineIssues.map((issue) => issue.message).join(" ") };

    const equipment = requestedLines.length === 1 ? getEquipment(requestedLines[0].equipmentId) : undefined;

    if (requestedLines.length === 1 && (!equipment || equipment.deleted || equipment.active === false)) {
      return {
        success: false,
        message: "Equipment is unavailable.",
      };
    }

    const assignment = requestedLines.length === 1 && requestedLines[0].assignmentId
      ? getAssignment(requestedLines[0].assignmentId)
      : undefined;

    const project = projects.find((candidate) => candidate.id === item.projectId);

    if (!project || project.deleted || project.status !== "Active") {
      return {
        success: false,
        message: "Select an active project.",
      };
    }

    if (!project.customerId || project.customerId !== item.customerId) {
      return { success: false, message: "The selected Project must belong to the selected Customer." };
    }

    if (requestedLines.length === 1 && !requestedLines[0].operatorId.trim()) {
      return {
        success: false,
        message: "Select an operator before creating a rental.",
      };
    }

    if (requestedLines.some((line) => !operators.some((operator) => operator.id === line.operatorId))) {
      return {
        success: false,
        message: "Selected operator was not found.",
      };
    }

    if (requestedLines.length === 1 && requestedLines[0].assignmentId && !assignment) {
      return {
        success: false,
        message: "Selected assignment was not found.",
      };
    }

    if (assignment && (
      assignment.status !== "Active" ||
      assignment.equipmentId !== requestedLines[0].equipmentId ||
      assignment.operatorId !== requestedLines[0].operatorId
    )) {
      return {
        success: false,
        message: "Rental relationships must match its active assignment.",
      };
    }

    // Re-read persisted records immediately before creating to protect against
    // stale pages and repeated submissions.
    if (requestedLines.some((line) => blockingEquipmentIds().has(line.equipmentId))) {
      return {
        success: false,
        message: "Equipment already has a non-final rental.",
      };
    }

    const availableForRental = Boolean(equipment && (
      equipment.status === "Available" ||
      (
        equipment.status === "Assigned" &&
        assignment?.status === "Active" &&
        assignment.equipmentId === equipment.id
      )));

    if (requestedLines.length === 1 && !availableForRental) {
      return {
        success: false,
        message: "Equipment is not available for rental.",
      };
    }

    const operationalMetadata = equipment ? createRentalOperationalMetadataSnapshot({
      equipment,
      assignment,
      costCodes: costCodeRepository.getAll(),
      activityCodes: activityCodeRepository.getAll(),
    }) : { snapshot: undefined };

    const created: RentalRecord = {
      ...item,
      operationalMetadata: operationalMetadata.snapshot,
      commercialSnapshotRequired: true,
      expectedReturn: item.expectedReturn || undefined,
      createdAt: new Date().toISOString(),
      status: "Draft",
      statusId: "",
      approvalStatus: "NotSubmitted",
    };
    rentalRepository.create(created);
    const timestamp = created.createdAt!;
    const createdLines: RentalEquipmentLine[] = requestedLines.map((requested) => {
      const machine = getEquipment(requested.equipmentId)!;
      const relatedAssignment = requested.assignmentId ? getAssignment(requested.assignmentId) : undefined;
      const metadata = createRentalOperationalMetadataSnapshot({ equipment: machine, assignment: relatedAssignment, costCodes: costCodeRepository.getAll(), activityCodes: activityCodeRepository.getAll() });
      return { id: crypto.randomUUID(), rentalId: created.id, equipmentId: requested.equipmentId, assignmentId: requested.assignmentId, operatorId: requested.operatorId, status: "Draft", operationalMetadata: metadata.snapshot, commercialSnapshotRequired: true, createdAt: timestamp, updatedAt: timestamp };
    });
    const savedLines = rentalEquipmentLineRepository.createMany(createdLines);
    if (!savedLines.success) { rentalRepository.delete(created.id); return savedLines; }
    refreshRentals();
    refreshRentalEquipmentLines();

    return { success: true };
  }

  function updateRental(item: RentalRecord) {
    if (!legacyMutationsEnabled) return;
    if (!hasPermission("rental.manage")) return;
    const current = rentalRepository.getById(item.id);
    if (!current) return;
    const materialChanged = current.customerId !== item.customerId || current.projectId !== item.projectId || current.dateOut !== item.dateOut || current.expectedReturn !== item.expectedReturn || JSON.stringify(current.deurExpectationPolicy) !== JSON.stringify(item.deurExpectationPolicy);
    const next = materialChanged ? invalidateRentalApproval(item, user, "Material Rental details changed.", new Date().toISOString()).rental : item;
    rentalRepository.update(next);
    if (materialChanged && current.approvalStatus === "Approved") auditRental(current, next, "APPROVAL_INVALIDATED", "Material Rental details changed.");
    refreshRentals();
  }
  function updateCustomerContact(id:string,input:RentalCustomerContactInput):RentalTransitionResult{if(!legacyMutationsEnabled)return unavailable();if(!hasPermission("rental.manage"))return{success:false,message:"You do not have permission to manage Rentals."};const current=rentalRepository.getById(id);if(!current)return{success:false,message:"Rental not found."};const result=updateRentalCustomerContact(current,input,{id:user?.id,name:user?.name??"",role:user?.role},new Date().toISOString(),developmentCustomerReviewOutbox.hasPendingForRental(current.rentalNumber??current.id),true);if(!result.success)return result;rentalRepository.update(result.rental);auditRental(current,result.rental,"CUSTOMER_CONTACT_UPDATED",`Customer review recipient changed from ${maskEmail(current.customerContactSnapshot?.representativeEmail)} to ${maskEmail(result.rental.customerContactSnapshot?.representativeEmail)}.`);refreshRentals();return{success:true,rental:result.rental}}

  function transitionRental(
    id: string,
    nextStatus: RentalLifecycleStatus
  ): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    const requiredPermission = nextStatus === "Released" ? "rental.release" : nextStatus === "Returned" ? "rental.return" : "rental.manage";
    if (!hasPermission(requiredPermission)) return { success: false, message: "You do not have permission to perform this Rental transition." };
    let current = rentalRepository.getById(id);

    if (!current) {
      return {
        success: false,
        message: "Rental not found.",
      };
    }

    if (nextStatus === "Reserved") {
      const lines = rentalEquipmentLineRepository.getByRentalId(current.id);
      const identityIssues = validateRentalLineIdentityIntegrity({ rental: current, lines, assignments, operators, equipment: equipmentRecords, projects });
      if (identityIssues.length) return { success: false, message: identityIssues.map((issue) => issue.message).join(" ") };
      const prepared = prepareRentalEquipmentLineRelease({ rental: current, lines, contracts: rentalContractRepository.ensureLineAssociations(lines).contracts, timestamp: new Date().toISOString() });
      if (!prepared.success) return { success: false, message: prepared.issues.map((issue) => issue.message).join(" "), issues: prepared.issues };
      const captured = rentalEquipmentLineRepository.saveCommercialSnapshotsOnce(current.id, prepared.lines);
      if (!captured.success) return { success: false, message: captured.message };
      const soleSnapshot = captured.lines.length === 1 ? captured.lines[0].commercialSnapshot : undefined;
      if (!current.commercialSnapshot && soleSnapshot) {
        current = { ...current, commercialSnapshot: structuredClone(soleSnapshot) };
        rentalRepository.update(current);
      }
      const readiness = releaseReadiness(current);
      if (!readiness.eligible) return { success: false, message: `RESERVATION_NOT_READY: ${readiness.incompleteEquipmentLines.map((line) => `${line.equipmentId ?? line.rentalEquipmentLineId}: ${[...line.missingFields.map(releaseFieldMessage), ...line.invalidValues].join(", ")}`).join("; ")}` };
    }

    if (nextStatus === "Released" && getRentalApprovalStatus(current) !== "Approved") {
      return { success: false, message: "Manager approval is required before equipment can be released." };
    }
    if (nextStatus === "Released") {
      const readiness = releaseReadiness(current);
      if (!readiness.eligible) return { success: false, message: `RELEASE_NOT_READY: ${readiness.incompleteEquipmentLines.map((line) => `${line.equipmentId ?? line.rentalEquipmentLineId}: ${[...line.missingFields.map(releaseFieldMessage), ...line.invalidValues].join(", ")}`).join("; ")}` };
    }

    if (nextStatus === "Closed") {
      const lines = rentalEquipmentLineRepository.getByRentalId(current.id);
      const deurs = deurRepository.getByRentalId(current.id);
      const statements = billingStatementRepository.getByRentalId(current.id);
      const totals = statements.map((statement) => reconcileStatementCollections(statement, collectionRepository.getByStatementId(statement.id)));
      const latestStatement = statements.at(-1);
      const readiness = buildCloseReadiness(buildRentalAggregate({
        rental: current,
        rentalEquipmentLines: lines,
        deurs,
        billing: {
          hasStatement: statements.length > 0,
          invoiceStatus: latestStatement?.invoiceStatus,
          invoicePreparationComplete: isInvoicePreparationComplete(latestStatement?.invoiceStatus),
          invoiced: totals.reduce((sum, item) => sum + item.invoiceTotal, 0),
          collected: totals.reduce((sum, item) => sum + item.totalCollected, 0),
          outstanding: totals.reduce((sum, item) => sum + item.outstandingBalance, 0),
        },
      }));
      if (!readiness.canClose) return { success: false, message: readiness.reasons.join(" ") };
    }

    const error = getRentalTransitionError(current, nextStatus);

    if (error) {
      return {
        success: false,
        message: error,
      };
    }

    const currentLines = rentalEquipmentLineRepository.ensureCompatibility(rentalRepository.getAll()).lines.filter((line) => line.rentalId === current.id);
    const equipmentChanges: Array<{ before: NonNullable<ReturnType<typeof getEquipment>>; after: NonNullable<ReturnType<typeof getEquipment>> }> = [];
    if (isEquipmentBlockingRental({ status: nextStatus })) {
      const conflicts = blockingEquipmentIds(current.id);
      const conflict = currentLines.find((line) => conflicts.has(line.equipmentId));
      if (conflict) return { success: false, message: `Equipment '${conflict.equipmentId}' already has a non-final Rental.` };
    }
    for (const line of currentLines) {
      const equipment = getEquipment(line.equipmentId);
      if (!equipment) return { success: false, message: `Equipment '${line.equipmentId}' was not found.` };
      let updatedEquipment = equipment;
      if (nextStatus === "Assigned" || nextStatus === "Reserved") updatedEquipment = { ...equipment, status: "Assigned", projectId: current.projectId ?? equipment.projectId, operatorId: line.operatorId };
      if (nextStatus === "Released") updatedEquipment = { ...equipment, status: "Rented" };
      if (nextStatus === "Returned") {
        if (equipment.status !== "Rented") return { success: false, message: `Equipment '${line.equipmentId}' is not currently rented.` };
        updatedEquipment = blockingEquipmentIds(current.id).has(line.equipmentId) ? { ...equipment, status: "Rented" } : { ...equipment, status: "Available", projectId: "", operatorId: "" };
      }
      if (nextStatus === "Cancelled") {
        const assignment = line.assignmentId ? getAssignment(line.assignmentId) : undefined;
        updatedEquipment = assignment?.status === "Active" ? { ...equipment, status: "Assigned", projectId: assignment.projectId, operatorId: assignment.operatorId } : { ...equipment, status: "Available", projectId: "", operatorId: "" };
      }
      if (updatedEquipment !== equipment) equipmentChanges.push({ before: equipment, after: updatedEquipment });
    }

    const timestamp = new Date().toISOString();
    const transitionTimestamp: Partial<Record<RentalLifecycleStatus, keyof Pick<RentalRecord,
      "reservedAt" | "releasedAt" | "activatedAt" | "returnedAt" | "closedAt" | "cancelledAt"
    >>> = {
      Reserved: "reservedAt",
      Released: "releasedAt",
      Active: "activatedAt",
      Returned: "returnedAt",
      Closed: "closedAt",
      Cancelled: "cancelledAt",
    } as const;
    const timestampField = transitionTimestamp[nextStatus];

    const policyFreeze = nextStatus === "Released"
      ? freezeRentalDeurExpectationPolicy(current, timestamp, deurShiftWindowRepository.getAll())
      : { success: true as const, rental: current };
    if (!policyFreeze.success) return { success: false, message: policyFreeze.message };

    let releaseRental = policyFreeze.rental;
    if (nextStatus === "Released") {
      const lineCompatibility = rentalEquipmentLineRepository.ensureCompatibility(rentalRepository.getAll());
      const lines = lineCompatibility.lines.filter((line) => line.rentalId === current.id);
      const lineIssues = validateRentalEquipmentLineInputs({
        rental: current,
        requested: lines.map((line) => ({ equipmentId: line.equipmentId, assignmentId: line.assignmentId, operatorId: line.operatorId })),
        existingLines: [], assignments, equipment: equipmentRecords, blockingEquipmentIds: blockingEquipmentIds(current.id), blockingOperatorIds: blockingOperatorIds(current.id), requireAtLeastOne: true,
      });
      if (lineIssues.length) return { success: false, message: lineIssues.map((issue) => issue.message).join(" ") };
      const contractCompatibility = rentalContractRepository.ensureLineAssociations(lineCompatibility.lines);
      const prepared = prepareRentalEquipmentLineRelease({ rental: current, lines, contracts: contractCompatibility.contracts, timestamp });
      if (!prepared.success) return { success: false, message: prepared.issues.map((issue) => issue.message).join(" "), issues: prepared.issues };
      const captured = rentalEquipmentLineRepository.saveCommercialSnapshotsOnce(current.id, prepared.lines);
      if (!captured.success) return { success: false, message: captured.message };
      const soleSnapshot = captured.lines.length === 1 ? captured.lines[0].commercialSnapshot : undefined;
      if (!releaseRental.commercialSnapshot && soleSnapshot) releaseRental = { ...releaseRental, commercialSnapshot: structuredClone(soleSnapshot) };
    }

    const updated: RentalRecord = {
      ...releaseRental,
      status: nextStatus,
      ...(timestampField ? { [timestampField]: timestamp } : {}),
      actualReturn:
        nextStatus === "Returned"
          ? timestamp.split("T")[0]
          : current.actualReturn,
    };

    rentalRepository.update(updated);
    rentalEquipmentLineRepository.updateRentalStatus(current.id, nextStatus, timestamp);
    refreshRentalEquipmentLines();

    for (const change of equipmentChanges) {
      updateEquipment(change.after);
      logAction({
        action: "UPDATE",
        equipmentId: change.before.id,
        before: change.before,
        after: change.after,
      });
      log(createHistoryEvent(
        change.before.id,
        `Rental ${nextStatus}`,
        `Rental transitioned to ${nextStatus}.`,
        nextStatus === "Returned" || nextStatus === "Cancelled"
          ? "RENTAL_RETURN"
          : "RENTED"
      ));
    }

    if (nextStatus === "Closed") {
      for (const line of currentLines) {
        const equipment = getEquipment(line.equipmentId);
        if (equipment) log(createHistoryEvent(equipment.id, "Rental Closed", "Rental was closed.", "RENTAL_RETURN"));
      }
    }

    if (nextStatus === "Returned") {
      for (const line of currentLines) {
        const assignment = line.assignmentId ? getAssignment(line.assignmentId) : undefined;
        if (assignment?.status === "Active") completeAssignment(assignment.id, new Date().toISOString().split("T")[0]);
      }
    }

    refreshRentals();

    if (["Released", "Active", "Returned", "Closed"].includes(nextStatus)) auditRental(current, updated, `RENTAL_${nextStatus.toUpperCase()}`);

    return {
      success: true,
      rental: updated,
    };
  }

  function deleteRental(id: string) {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.manage")) return { success: false, message: "You do not have permission to manage Rentals." };
    const rental = rentalRepository.getById(id);

    if (!rental) {
      return { success: false, message: "Rental not found." };
    }

    if (["Released", "Active", "Returned", "Closed"].includes(rental.status)) {
      return {
        success: false,
        message: "This rental is a transaction record and cannot be deleted.",
      };
    }

    rentalRepository.delete(id);
    refreshRentals();

    return { success: true };
  }

  function returnRental(id: string): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.return")) return { success: false, message: "You do not have permission to return Rental equipment." };
    const rental = rentalRepository.getById(id);
    if (!rental) return { success: false, message: "Rental not found." };
    const lines = rentalEquipmentLineRepository.getByRentalId(id);
    if (!lines.length) return { success: false, message: "No Rental Equipment Lines were found." };
    const returnedAt = new Date().toISOString();
    const deurs = deurRepository.getByRentalId(id);
    const linesToReturn = lines.filter((line) => ["Released", "Active"].includes(line.status));
    if (!linesToReturn.length) return { success: false, message: "All Rental Equipment Lines are already returned." };
    const prepared = linesToReturn.map((line) => {
      const equipment = getEquipment(line.equipmentId);
      return equipment ? returnEquipmentLine({ rental, line, equipment, deurs, returnedAt, liveShiftWindows: deurShiftWindowRepository.getAll() }) : { success: false as const, code: "EQUIPMENT_NOT_FOUND", message: "Rental equipment was not found." };
    });
    const blocked = prepared.find((result) => !result.success);
    if (blocked) return { success: false, message: blocked.message };

    prepared.forEach((result, index) => {
      if (!result.success) return;
      rentalEquipmentLineRepository.update(result.line);
      const before = getEquipment(result.line.equipmentId);
      const after = blockingEquipmentIds(id).has(result.line.equipmentId)
        ? { ...result.equipment, status: "Rented" as const }
        : result.equipment;
      updateEquipment(after);
      if (before) {
        logAction({ action: "UPDATE", equipmentId: before.id, before, after });
        log(createHistoryEvent(before.id, "Rental Returned", "Rental equipment was returned.", "RENTAL_RETURN"));
      }
      const assignmentId = linesToReturn[index].assignmentId;
      if (assignmentId && getAssignment(assignmentId)?.status === "Active") completeAssignment(assignmentId, returnedAt.split("T")[0]);
    });
    const updated = { ...rental, status: "Returned" as const, returnedAt, actualReturn: returnedAt.split("T")[0] };
    rentalRepository.update(updated);
    refreshRentalEquipmentLines();
    refreshRentals();
    auditRental(rental, updated, "RENTAL_RETURNED");
    notifyRentalWorkspaceChange(id);
    return { success: true, rental: updated };
  }

  function releaseRental(
    id: string,
    releasedBy: string
  ): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.release")) return { success: false, message: "An Admin must release this equipment." };

    const current = rentalRepository.getById(id);
    if (!current) return { success: false, message: "Rental not found." };
    if (getRentalApprovalStatus(current) !== "Approved") return { success: false, message: "Manager approval is required before equipment can be released." };

    const actorName = releasedBy.trim();
    if (!actorName || actorName !== user?.name) {
      return { success: false, message: "Select the signed-in Admin as Released By." };
    }
    const readiness = releaseReadiness(current);
    if (!readiness.eligible) return { success: false, message: `RELEASE_NOT_READY: ${readiness.incompleteEquipmentLines.map((line) => `${line.equipmentId ?? line.rentalEquipmentLineId}: ${[...line.missingFields.map(releaseFieldMessage), ...line.invalidValues].join(", ")}`).join("; ")}` };

    const result = transitionRental(id, "Released");

    if (!result.success || !result.rental) {
      return result;
    }

    const updated = {
      ...result.rental,
      rentedBy: actorName,
    };
    rentalRepository.update(updated);
    refreshRentals();

    return { success: true, rental: updated };
  }

  function submitForApproval(id: string): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.approval.submit")) return { success: false, message: "You do not have permission to submit Rental approvals." };
    const rental = rentalRepository.getById(id);
    if (!rental) return { success: false, message: "Rental not found." };
    const lines = rentalEquipmentLineRepository.getByRentalId(id);
    const contracts = rentalContractRepository.ensureLineAssociations(rentalEquipmentLineRepository.getAll()).contracts;
    const requestedAt = new Date().toISOString();
    const prepared = prepareRentalEquipmentLineRelease({ rental, lines, contracts, timestamp: requestedAt });
    const result = submitRentalApproval(rental, user, prepared.success, requestedAt, true);
    if (!result.success) return { success: false, message: prepared.success ? result.message : prepared.issues.map((issue) => issue.message).join(" ") };
    const approver = resolveActiveManagerApprover();
    if (!approver.success) return { success: false, message: approver.message };
    const snapshot = buildManagerApprovalEmailSnapshot({
      rental: result.rental,
      lines,
      contracts,
      equipment: equipmentRecords,
      assignments,
      operators,
      project: projects.find((project) => project.id === rental.projectId),
      requestedBy: user?.name ?? "Unknown requester",
      requestedAt,
      commercialTermsComplete: prepared.success,
      conflictsDetected: lines.some((line) => blockingEquipmentIds(rental.id).has(line.equipmentId)),
    });
    rentalRepository.update(result.rental);
    developmentApprovalEmailOutbox.create({ rentalId: rental.id, recipientName: approver.configuration.name, recipient: approver.configuration.email, generatedAt: requestedAt, snapshot });
    auditRental(rental, result.rental, result.event.action === "Resubmitted" ? "RENTAL_APPROVAL_RESUBMITTED" : "RENTAL_APPROVAL_SUBMITTED", `Approval Requested. Recipient: ${approver.configuration.name} <${approver.configuration.email}>.`);
    refreshRentals();
    return { success: true, rental: result.rental };
  }

  function approveRental(id: string, remarks = ""): RentalTransitionResult {
    return decideApproval(id, "Approved", remarks);
  }

  function rejectRental(id: string, reason: string): RentalTransitionResult {
    return decideApproval(id, "Rejected", reason);
  }

  function decideApproval(id: string, decision: "Approved" | "Rejected", remarks: string): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.approval.decide")) return { success: false, message: "You do not have permission to decide Rental approvals." };
    const rental = rentalRepository.getById(id);
    if (!rental) return { success: false, message: "Rental not found." };
    const result = decideRentalApproval(rental, user, decision, remarks, new Date().toISOString(), true);
    if (!result.success) return { success: false, message: result.message };
    rentalRepository.update(result.rental);
    developmentApprovalEmailOutbox.setDecision(rental.id, decision, result.event.timestamp);
    auditRental(rental, result.rental, decision === "Approved" ? "RENTAL_APPROVED" : "RENTAL_REJECTED", remarks);
    refreshRentals();
    return { success: true, rental: result.rental };
  }

  function getRental(id: string) {
    return rentalRepository.getById(id);
  }

  function addContract(contract: RentalContractRecord) {
    if (!legacyMutationsEnabled) return;
    if (!hasPermission("rental.commercialTerms.update")) return;
    rentalContractRepository.create(contract);
    refreshContracts();
  }

  function updateContract(contract: RentalContractRecord) {
    if (!legacyMutationsEnabled) return;
    if (!hasPermission("rental.commercialTerms.update")) return;
    const rentalId = contract.rentalId ?? contract.id;
    const rental = rentalRepository.getById(rentalId);
    const lineId = contract.rentalEquipmentLineId ?? rentalEquipmentLineRepository.getByRentalId(rentalId).at(0)?.id;
    const line = lineId ? rentalEquipmentLineRepository.getById(lineId) : undefined;
    if (!rental || !canEditRentalCommercialTerms(rental) || line?.commercialSnapshot) return;
    rentalContractRepository.update(contract);
    invalidateApprovedRental(rentalId, "Commercial Terms changed.");
    refreshContracts();
  }

  function deleteContract(id: string) {
    if (!legacyMutationsEnabled) return;
    if (!hasPermission("rental.commercialTerms.update")) return;
    rentalContractRepository.delete(id);
    refreshContracts();
  }

  function getContract(id: string) {
    const direct = contracts.find((contract) => contract.id === id);
    if (direct) return direct;
    const lines = rentalEquipmentLines.filter((line) => line.rentalId === id);
    return lines.length === 1 ? contracts.find((contract) => contract.rentalEquipmentLineId === lines[0].id) : undefined;
  }

  function saveCommercialTerms(id: string, input: RentalCommercialTermsInput): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    const lines = rentalEquipmentLineRepository.getByRentalId(id);
    if (lines.length !== 1) return { success: false, message: "A single Rental Equipment Line is required by the compatibility save path." };
    return saveCommercialTermsForRentalEquipmentLine(id, lines[0].id, input);
  }

  function getContractForRentalEquipmentLine(lineId: string) {
    const lookup = rentalContractRepository.getByRentalEquipmentLineId(lineId);
    return lookup.status === "found" ? lookup.contract : undefined;
  }

  function saveCommercialTermsForRentalEquipmentLine(rentalId: string, lineId: string, input: RentalCommercialTermsInput): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.commercialTerms.update")) return { success: false, message: "You do not have permission to edit Commercial Terms." };
    const rental = rentalRepository.getById(rentalId);
    if (!rental) return { success: false, message: "Rental not found." };
    const line = rentalEquipmentLineRepository.getById(lineId);
    if (!line) return { success: false, message: "Rental Equipment Line not found." };
    const lookup = rentalContractRepository.getByRentalEquipmentLineId(lineId);
    if (lookup.status === "ambiguous") return { success: false, message: lookup.issue.message };
    const configured = configureRentalCommercialTerms({
      rental, line, equipmentId: line.equipmentId, commercialTerms: input,
      existingContract: lookup.status === "found" ? lookup.contract : undefined,
      timestamp: new Date().toISOString(),
    });
    if (!configured.success) return configured;
    const saved = rentalContractRepository.saveForRentalEquipmentLine(configured.contract);
    if (!saved.success) return { success: false, message: saved.issue.message };
    refreshContracts();
    invalidateApprovedRental(rentalId, "Commercial Terms changed.");
    return { success: true, rental };
  }

  function saveCommercialTermsForSelectedLines(rentalId: string, lineIds: string[], input: RentalCommercialTermsInput): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.commercialTerms.update")) return { success: false, message: "You do not have permission to edit Commercial Terms." };
    const rental = rentalRepository.getById(rentalId);
    if (!rental) return { success: false, message: "Rental not found." };
    const selected = lineIds.map((id) => rentalEquipmentLineRepository.getById(id));
    if (selected.some((line) => !line || line.rentalId !== rentalId)) return { success: false, message: "A selected Rental Equipment Line was not found." };
    const configured = configureBulkRentalCommercialTerms({ rental, lines: selected as RentalEquipmentLine[], commercialTerms: input, existingContracts: rentalContractRepository.listByRentalId(rentalId), timestamp: new Date().toISOString() });
    if (!configured.success) return { success: false, message: `${configured.lineId ?? "Selected line"}: ${configured.message}` };
    const saved = rentalContractRepository.saveManyForRentalEquipmentLines(configured.contracts);
    if (!saved.success) return { success: false, message: saved.issue.message };
    refreshContracts();
    invalidateApprovedRental(rentalId, "Commercial Terms changed.");
    return { success: true, rental };
  }

  function addRentalEquipmentLine(rentalId: string, input: NewRentalEquipmentLineInput) {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.manage")) return { success: false, message: "You do not have permission to manage Rentals." };
    const rental = rentalRepository.getById(rentalId);
    if (!rental) return { success: false, message: "Rental not found." };
    const existingLines = rentalEquipmentLineRepository.getByRentalId(rentalId);
    const issues = validateRentalEquipmentLineInputs({ rental, requested: [input], existingLines, assignments, equipment: equipmentRecords, blockingEquipmentIds: blockingEquipmentIds(rentalId) });
    if (issues.length) return { success: false, message: issues.map((issue) => issue.message).join(" "), issues };
    const machine = getEquipment(input.equipmentId)!;
    const assignment = input.assignmentId ? getAssignment(input.assignmentId) : undefined;
    const timestamp = new Date().toISOString();
    const metadata = createRentalOperationalMetadataSnapshot({ equipment: machine, assignment, costCodes: costCodeRepository.getAll(), activityCodes: activityCodeRepository.getAll() });
    const saved = rentalEquipmentLineRepository.createMany([{ id: crypto.randomUUID(), rentalId, equipmentId: input.equipmentId, assignmentId: input.assignmentId, operatorId: input.operatorId, status: rental.status, operationalMetadata: metadata.snapshot, commercialSnapshotRequired: true, createdAt: timestamp, updatedAt: timestamp }]);
    if (!saved.success) return saved;
    if (existingLines.length >= 1) rentalRepository.update({ ...rental, equipmentId: "", assignmentId: undefined, operatorId: undefined, commercialSnapshot: undefined });
    updateEquipment({ ...machine, status: "Assigned", projectId: rental.projectId ?? machine.projectId, operatorId: input.operatorId });
    refreshRentals();
    refreshRentalEquipmentLines();
    invalidateApprovedRental(rentalId, "Rental Equipment Lines changed.");
    return { success: true };
  }

  function removeRentalEquipmentLine(rentalId: string, lineId: string) {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.manage")) return { success: false, message: "You do not have permission to manage Rentals." };
    const rental = rentalRepository.getById(rentalId);
    const line = rentalEquipmentLineRepository.getById(lineId);
    if (!rental || !line || line.rentalId !== rentalId) return { success: false, message: "Rental Equipment Line not found." };
    const issue = canRemoveRentalEquipmentLine(rental, line);
    if (issue) return { success: false, message: issue.message, issues: [issue] };
    const machine = getEquipment(line.equipmentId);
    if (!rentalEquipmentLineRepository.remove(lineId)) return { success: false, message: "Rental Equipment Line not found." };
    const contract = rentalContractRepository.getByRentalEquipmentLineId(lineId);
    if (contract.status === "found") rentalContractRepository.delete(contract.contract.id);
    const remaining = rentalEquipmentLineRepository.getByRentalId(rentalId);
    if (remaining.length === 1) rentalRepository.update({ ...rental, equipmentId: remaining[0].equipmentId, assignmentId: remaining[0].assignmentId, operatorId: remaining[0].operatorId, operationalMetadata: remaining[0].operationalMetadata });
    if (remaining.length === 0) rentalRepository.update({ ...rental, equipmentId: "", assignmentId: undefined, operatorId: undefined, operationalMetadata: undefined, commercialSnapshot: undefined });
    if (machine && !blockingEquipmentIds(rentalId).has(machine.id)) {
      const assignment = line.assignmentId ? getAssignment(line.assignmentId) : undefined;
      updateEquipment(assignment?.status === "Active" ? { ...machine, status: "Assigned", projectId: assignment.projectId, operatorId: assignment.operatorId } : { ...machine, status: "Available", projectId: "", operatorId: "" });
    }
    refreshRentals();
    refreshRentalEquipmentLines();
    invalidateApprovedRental(rentalId, "Rental Equipment Lines changed.");
    return { success: true };
  }

  function returnRentalEquipmentLine(rentalId: string, lineId: string): RentalTransitionResult {
    if (!legacyMutationsEnabled) return unavailable();
    if (!hasPermission("rental.return")) return { success: false, message: "You do not have permission to return Rental equipment." };
    const rental = rentalRepository.getById(rentalId);
    const line = rentalEquipmentLineRepository.getById(lineId);
    const machine = line ? getEquipment(line.equipmentId) : undefined;
    if (!rental || !line || line.rentalId !== rentalId || !machine) return { success: false, message: "Rental Equipment Line was not found." };
    const result = returnEquipmentLine({ rental, line, equipment: machine, deurs: deurRepository.getByRentalId(rentalId), returnedAt: new Date().toISOString(), liveShiftWindows: deurShiftWindowRepository.getAll() });
    if (!result.success) return { success: false, message: result.message };
    rentalEquipmentLineRepository.update(result.line);
    const returnedEquipment = blockingEquipmentIds(rentalId).has(line.equipmentId)
      ? { ...result.equipment, status: "Rented" as const }
      : result.equipment;
    updateEquipment(returnedEquipment);
    logAction({ action: "UPDATE", equipmentId: machine.id, before: machine, after: returnedEquipment });
    log(createHistoryEvent(machine.id, "Rental Returned", "Rental equipment line was returned.", "RENTAL_RETURN"));
    if (line.assignmentId) completeAssignment(line.assignmentId, result.line.updatedAt.split("T")[0]);
    const remainingLines = rentalEquipmentLineRepository.getByRentalId(rentalId);
    const allReturned = resolveRentalStatusAfterLineReturn(remainingLines) === "Returned";
    const updatedRental = allReturned
      ? { ...rental, status: "Returned" as const, returnedAt: result.line.updatedAt, actualReturn: result.line.updatedAt.split("T")[0] }
      : rental;
    if (allReturned) {
      rentalRepository.update(updatedRental);
      refreshRentals();
      auditRental(rental, updatedRental, "RENTAL_RETURNED");
    }
    refreshRentalEquipmentLines();
    notifyRentalWorkspaceChange(rentalId, { rentalLineId: line.id, equipmentId: line.equipmentId, operatorId: line.operatorId });
    return { success: true, rental: updatedRental };
  }

  const value = useMemo(
    () => ({
      rentals,
      addRental,
      updateRental,
      updateCustomerContact,
      transitionRental,
      deleteRental,
      returnRental,
      returnRentalEquipmentLine,
      releaseRental,
      submitForApproval,
      approveRental,
      rejectRental,
      getRental,
      contracts,
      addContract,
      updateContract,
      deleteContract,
      getContract,
      saveCommercialTerms,
      getContractForRentalEquipmentLine,
      saveCommercialTermsForRentalEquipmentLine,
      saveCommercialTermsForSelectedLines,
      rentalEquipmentLines,
      rentalEquipmentLineMigrationIssues,
      addRentalEquipmentLine,
      removeRentalEquipmentLine,
      getReleaseReadiness,
      configureLineDeurExpectation,
    }),
    [rentals, contracts, rentalEquipmentLines, rentalEquipmentLineMigrationIssues, getAssignment, user, assignments, operators, equipmentRecords, projects, workDescriptions]
  );

  return (
    <RentalContext.Provider value={value}>
      {children}
    </RentalContext.Provider>
  );
}

export function useRental() {
  const context = useContext(RentalContext);

  if (!context) {
    throw new Error(
      "useRental must be used within RentalProvider"
    );
  }

  return context;
}
