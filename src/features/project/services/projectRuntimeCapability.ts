import { PersistenceMode, type ApplicationDependencies } from "@/app/composition";

type Configuration = ApplicationDependencies["configuration"];

export interface ProjectRuntimeCapability {
  canonicalReads: boolean;
  legacyReads: boolean;
  legacyMutations: boolean;
  canonicalMutations: boolean;
}

export const REMOTE_PROJECT_MUTATION_UNAVAILABLE_MESSAGE = "Project changes are unavailable in remote mode until the canonical command boundary is certified.";

export function getProjectRuntimeCapability(configuration: Configuration, canonicalRepositoryAvailable = false): ProjectRuntimeCapability {
  const local = configuration.persistenceMode === PersistenceMode.Local;
  return {
    canonicalReads: !local,
    legacyReads: local,
    legacyMutations: local,
    canonicalMutations: !local && configuration.remoteOperationalWritesEnabled && canonicalRepositoryAvailable,
  };
}

export function canLinkProjectCustomer(configuration: Configuration, repositoryAvailable = false) {
  return configuration.persistenceMode === PersistenceMode.Remote
    && configuration.remoteProjectCustomerLinkEnabled === true
    && repositoryAvailable;
}
