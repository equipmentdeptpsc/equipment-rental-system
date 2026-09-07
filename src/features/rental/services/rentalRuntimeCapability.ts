import { PersistenceMode, type ApplicationDependencies } from "@/app/composition";

type RentalRuntimeConfiguration = ApplicationDependencies["configuration"];

export const REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE =
  "Rental creation and changes are not enabled in this UAT environment.";

export function canUseLegacyRentalMutations(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Local;
}

export function canUseCanonicalRemoteRentalMutations(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Remote && configuration.remoteOperationalWritesEnabled;
}

export function canUseCanonicalRemoteRentalCreation(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Remote
    && (configuration.remoteOperationalWritesEnabled || configuration.remoteRentalCreateEnabled === true);
}

export function canUseCanonicalRemoteRentalCommercialTermsMutation(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Remote
    && configuration.remoteRentalCommercialTermsEnabled === true;
}

export function canUseCanonicalRemoteRentalApprovalMutations(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Remote
    && (configuration.remoteOperationalWritesEnabled === true || configuration.remoteRentalApprovalEnabled === true);
}

export function canUseCanonicalRemoteRentalReserveMutation(configuration: RentalRuntimeConfiguration): boolean {
  return configuration.persistenceMode === PersistenceMode.Remote
    && (configuration.remoteOperationalWritesEnabled === true || configuration.remoteRentalReserveEnabled === true);
}

export function canUseAnyRentalMutations(configuration: RentalRuntimeConfiguration, canonicalRepositoryAvailable: boolean): boolean {
  return canUseLegacyRentalMutations(configuration)
    || ((canUseCanonicalRemoteRentalMutations(configuration) || canUseCanonicalRemoteRentalApprovalMutations(configuration) || canUseCanonicalRemoteRentalReserveMutation(configuration)) && canonicalRepositoryAvailable);
}
