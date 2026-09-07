import { storage } from "@/core/storage";
import { LocalStoragePersistenceAdapter } from "@/core/persistence";
import { equipmentRepository } from "@/features/equipment/repository";
import { assignmentRepository } from "@/features/assignment/repository";
import { rentalRepository } from "@/features/rental/repository";
import { rentalContractRepository } from "@/features/rental/repository/rentalContractRepository";
import { rentalEquipmentLineRepository } from "@/features/rental/equipment-line";
import { deurRepository } from "@/features/rental/deur/repository/deurRepository";
import { billingStatementRepository } from "@/features/rental/billingstatement/repository";
import { prefixRepository } from "@/features/settings/repository/prefixRepository";
import { costCodeRepository } from "@/features/masters/cost-code/repository";
import { activityCodeRepository } from "@/features/masters/activity-code/repository";
import { deurShiftWindowRepository } from "@/features/rental/deur/shift-window/repository";
import type { ApplicationDependencies, ApplicationDependencyOverrides, RepositoryDependencies } from "./ApplicationDependencies";
import { LocalEquipmentStatusReadRepository } from "@/features/masters/equipment-status/repository";
import { LocalUserRepository } from "@/features/auth/repository/LocalUserRepository";
import { LocalAuthRepository } from "@/features/auth/repository/LocalAuthRepository";
import { AuthenticationService } from "@/features/auth/services/AuthenticationService";
import { AuthorizationService } from "@/features/auth/services/AuthorizationService";
import { LegacyAuthCompatibilityRepository } from "@/features/auth/repository/LegacyAuthCompatibilityRepository";
import { LocalAuthenticationProvider } from "@/features/auth/providers/local/LocalAuthenticationProvider";
import { UserManagementService } from "@/features/users/services/UserManagementService";
import { AuthorizationAuditService } from "@/features/administration/services/AuthorizationAuditService";
import { LocalReadRepository } from "@/core/remote";
import { customerRepository } from "@/features/customer/repository";
import { projectRepository } from "@/features/project/repository";
import { operatorRepository } from "@/features/operators/repository";
import { PersistenceMode } from "./ApplicationDependencies";
import { LocalOperatorCertificationRepository } from "@/features/operators/certifications/repository";
import { LocalEquipmentSubcategoryReadRepository, LocalEquipmentCategoryReadRepository } from "@/features/masters/equipment-subcategory/canonical";
import { LocalEquipmentMaintenanceSnapshotRepository } from "@/features/maintenance/canonical";
import { LocalEquipmentLifecycleSummaryRepository } from "@/features/equipment/history/canonical";
import { LocalEquipmentRentalLifecycleHistoryRepository } from "@/features/rental/history/canonical";
import { LocalCanonicalBookingReadRepository } from "@/features/booking/canonical";
import { LocalEquipmentAvailabilityRepository } from "@/features/equipment/availability/canonical";
import { maintenanceRepository } from "@/features/maintenance/repository";
import { LocalDeurCommandRepository } from "@/features/rental/deur/commands/LocalDeurCommandRepository";
import { subscribeDeurChanges } from "@/features/rental/deur/synchronization/deurChangeNotifications";
import { workDescriptionRepository } from "@/features/masters/work-description";
import { createLocalOperationalCommands } from "@/features/rental/operations/commands/UnavailableOperationalCommandRepository";
import { OperatorPinCredentialService } from "@/features/auth/services/OperatorPinCredentialService";
import {
  InMemoryOperationalEventRepository,
  IndexedDbOfflineOperationalCommandQueue,
  InMemoryOfflineOperationalCommandQueue,
  BrowserReplayCoordinator,
  OperationalEventStream,
  OperatorSynchronizationService,
  PollingOperationalEventTransport,
  WorkspaceSynchronization,
} from "@/features/rental/realtime";

const localRepositories: RepositoryDependencies = { equipment: equipmentRepository, assignment: assignmentRepository, rental: rentalRepository, rentalContract: rentalContractRepository, rentalEquipmentLine: rentalEquipmentLineRepository, deur: deurRepository, billingStatement: billingStatementRepository, prefix: prefixRepository, costCode: costCodeRepository, activityCode: activityCodeRepository, deurShiftWindow: deurShiftWindowRepository,equipmentStatusRead:new LocalEquipmentStatusReadRepository() };
export function createLocalApplicationDependencies(overrides: ApplicationDependencyOverrides = {}): ApplicationDependencies {
  const userRepository = overrides.authentication?.userRepository ?? new LocalUserRepository(storage);
  if (userRepository instanceof LocalUserRepository) userRepository.initializeSeedUsers();
  const authRepository = overrides.authentication?.authRepository ?? new LocalAuthRepository(storage, userRepository as LocalUserRepository);
  const authenticationProviders = overrides.authentication?.authenticationProviders ?? [
    new LocalAuthenticationProvider(authRepository, userRepository),
  ];
  const authenticationService = overrides.authentication?.authenticationService ?? new AuthenticationService(authenticationProviders, userRepository);
  const authorizationService = overrides.authentication?.authorizationService ?? new AuthorizationService({ getById: (id) => operatorRepository.getById(id) });
  const authorizationAuditService=new AuthorizationAuditService();
  const referenceValues=()=>[equipmentRepository.getAll(),assignmentRepository.getAll(),rentalRepository.getAll(),rentalContractRepository.getAll(),rentalEquipmentLineRepository.getAll(),deurRepository.getAll(),billingStatementRepository.getAll()];
  const containsUserReference=(value:unknown,userId:string):boolean=>{if(Array.isArray(value))return value.some(item=>containsUserReference(item,userId));if(!value||typeof value!=="object")return false;return Object.entries(value).some(([key,item])=>["userId","actorId","createdByUserId","updatedByUserId","approvedByUserId"].includes(key)?item===userId:containsUserReference(item,userId))};
  const userManagementService = overrides.authentication?.userManagementService ?? new UserManagementService(
    userRepository,
    { create: (user, initialPassword) => {
      if (!(userRepository instanceof LocalUserRepository)) throw new Error("Local user provisioning is unavailable.");
      return userRepository.createUser(user, initialPassword);
    }, replacePassword: (userId, newPassword) => {
      if (!(userRepository instanceof LocalUserRepository)) throw new Error("Password reset is unavailable because this user is not managed by the Local Authentication Provider.");
      return userRepository.replaceLocalPassword(userId, newPassword);
    } },
    undefined,
    undefined,
    { getById: (id) => operatorRepository.getById(id) },
    authorizationService, undefined, authorizationAuditService,
    {hasBusinessReferences:user=>referenceValues().some(value=>containsUserReference(value,user.id)),hasBlockingAuditHistory:user=>authorizationAuditService.hasBlockingUserHistory(user.id)},
  );
  const authentication = {
    authRepository,
    authenticationProviders,
    userRepository,
    authenticationService,
    authorizationService,
    legacyCompatibilityRepository: overrides.authentication?.legacyCompatibilityRepository ?? new LegacyAuthCompatibilityRepository(storage),
    userManagementService,
    operatorPinCredentialService: new OperatorPinCredentialService(
      storage,
      userRepository,
      { getAll: () => operatorRepository.getAll(), getById: (id) => operatorRepository.getById(id) },
      authRepository,
      (operatorId) => assignmentRepository.getAll().some((assignment) => assignment.operatorId === operatorId && assignment.status === "Active"),
    ),
  };
  const currentAuthenticatedUser = () => {
    const session = authRepository.getCurrentSession();
    return session ? userRepository.getUserById(session.userId) ?? null : null;
  };
  const repositories = { ...localRepositories, ...overrides.repositories };
  const readRepositories = {
    users: new LocalReadRepository(() => userRepository.getUsers()),
    equipment: new LocalReadRepository(() => repositories.equipment.getAll()),
    rentals: new LocalReadRepository(() => repositories.rental.getAll()),
    assignments: new LocalReadRepository(() => repositories.assignment.getAll()),
    operators: new LocalReadRepository(() => operatorRepository.getAll()),
    customers: new LocalReadRepository(() => customerRepository.getAll()),
    projects: new LocalReadRepository(() => projectRepository.getAll()),
    billing: new LocalReadRepository(() => repositories.billingStatement.getAll()),
    deurs: new LocalReadRepository(() => repositories.deur.getAll()),
    rentalEquipmentLines: new LocalReadRepository(() => repositories.rentalEquipmentLine.getAll()),
    workDescriptions: new LocalReadRepository(() => workDescriptionRepository.getAll()),
    canonicalAudit: new LocalReadRepository(() => []),
    certificationTypes: new LocalReadRepository(() => []),
    equipmentSubcategories: new LocalEquipmentSubcategoryReadRepository(),
    equipmentCategories: new LocalEquipmentCategoryReadRepository(),
    maintenance: new LocalEquipmentMaintenanceSnapshotRepository(() => maintenanceRepository.getAll()),
    lifecycleSummary: new LocalEquipmentLifecycleSummaryRepository(),
    rentalLifecycleHistory: new LocalEquipmentRentalLifecycleHistoryRepository(),
    canonicalBookings: new LocalCanonicalBookingReadRepository(),
    equipmentAvailability: new LocalEquipmentAvailabilityRepository(),
    operatorCertifications: new LocalOperatorCertificationRepository(),
  };
  const synchronization = overrides.synchronization ?? (() => {
    const repository = new InMemoryOperationalEventRepository();
    const transport = new PollingOperationalEventTransport(repository);
    const stream = new OperationalEventStream(transport);
    return {
      tenantId: "TENANT-LOCAL-001",
      publishEnabled: true,
      transportMode: "local" as const,
      repository,
      transport,
      stream,
      operator: new OperatorSynchronizationService(stream),
      workspace: new WorkspaceSynchronization(stream),
      offlineQueue: typeof indexedDB === "undefined"
        ? new InMemoryOfflineOperationalCommandQueue()
        : new IndexedDbOfflineOperationalCommandQueue(),
      replayCoordinator: new BrowserReplayCoordinator(typeof navigator !== "undefined" ? navigator.locks : undefined),
    };
  })();
  return { persistence: overrides.persistence ?? new LocalStoragePersistenceAdapter(storage), repositories,readRepositories,commandRepositories:{deurCommands:new LocalDeurCommandRepository(currentAuthenticatedUser),operatorCertifications:new LocalOperatorCertificationRepository(),...createLocalOperationalCommands()},changeNotifications:{subscribeDeur:subscribeDeurChanges},synchronization,authentication,configuration:{equipmentStatusSource:"local",persistenceMode:PersistenceMode.Local,remoteOperationalWritesEnabled:false,remoteRentalApprovalEnabled:false,remoteRentalReserveEnabled:false,remoteRentalReleaseEnabled:false}, compatibility: { sharedLegacySingletons: Object.keys(localRepositories) as Array<keyof RepositoryDependencies> } };
}
