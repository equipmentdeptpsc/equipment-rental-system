import { PersistenceMode, type ApplicationDependencies } from "@/app/composition";
import type { AssignmentRecord } from "@/features/assignment/types";

type Configuration = ApplicationDependencies["configuration"];

export interface AssignmentRuntimeCapability {
  canonicalReads: boolean;
  legacyReads: boolean;
  legacyMutations: boolean;
  canonicalMutations: boolean;
  canonicalCreation: boolean;
  canonicalCancellation: boolean;
}

export function getAssignmentRuntimeCapability(configuration: Configuration, canonicalRepositoryAvailable = false): AssignmentRuntimeCapability {
  const local = configuration.persistenceMode === PersistenceMode.Local;
  const canonicalMutations = !local && configuration.remoteOperationalWritesEnabled && canonicalRepositoryAvailable;
  const canonicalCancellation = !local && configuration.remoteAssignmentCancelEnabled === true && canonicalRepositoryAvailable;
  return { canonicalReads: !local, legacyReads: local, legacyMutations: local, canonicalMutations, canonicalCreation: !local && canonicalRepositoryAvailable && (configuration.remoteOperationalWritesEnabled || configuration.remoteAssignmentCreateEnabled === true), canonicalCancellation };
}

export function canStartRentalFromCanonicalAssignment(input: {
  assignment?: AssignmentRecord;
  rentalCreationAvailable: boolean;
  hasRentalManagePermission: boolean;
}) {
  return Boolean(input.assignment && input.assignment.status === "Active" && input.rentalCreationAvailable && input.hasRentalManagePermission);
}

export const REMOTE_ASSIGNMENT_MUTATION_UNAVAILABLE_MESSAGE = "Assignment changes are unavailable in remote mode until the canonical command boundary is certified.";
