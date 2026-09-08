import type { PersistenceAdapter } from "@/core/persistence";
import type { assignmentRepository } from "@/features/assignment/repository";
import type { rentalContractRepository } from "@/features/rental/repository/rentalContractRepository";
import type { rentalEquipmentLineRepository } from "@/features/rental/equipment-line";
import type { deurRepository } from "@/features/rental/deur/repository/deurRepository";
import type { billingStatementRepository } from "@/features/rental/billingstatement/repository";
import type { prefixRepository } from "@/features/settings/repository/prefixRepository";
import type { costCodeRepository } from "@/features/masters/cost-code";
import type { activityCodeRepository } from "@/features/masters/activity-code";
import type { deurShiftWindowRepository } from "@/features/rental/deur/shift-window/repository";
import type { IEquipmentRepository } from "@/features/equipment/repository/IEquipmentRepository";
import type { IRentalRepository } from "@/features/rental/repository/IRentalRepository";
import type { ReadOnlyEquipmentStatusRepository } from "@/features/masters/equipment-status/repository";
import type { AuthRepository } from "@/features/auth/repository/AuthRepository";
import type { UserRepository } from "@/features/auth/repository/UserRepository";
import type { AuthenticationService } from "@/features/auth/services/AuthenticationService";
import type { AuthorizationService } from "@/features/auth/services/AuthorizationService";
import type { LegacyAuthCompatibilityRepository } from "@/features/auth/repository/LegacyAuthCompatibilityRepository";
import type { AuthenticationProvider } from "@/features/auth/providers/AuthenticationProvider";
import type { UserManagementService } from "@/features/users/services/UserManagementService";
import type { ReadOnlyRepository } from "@/core/remote";
import type { User } from "@/features/auth/domain/user";
import type { EquipmentRecord } from "@/features/equipment/types";
import type { RentalRecord } from "@/features/rental/types";
import type { AssignmentRecord } from "@/features/assignment/types";
import type { Operator } from "@/features/operators/types";
import type { CustomerRecord } from "@/features/customer/types";
import type { ProjectRecord } from "@/features/project/types";
import type { BillingStatement } from "@/features/rental/billingstatement/types";
import type { DeurRecord } from "@/features/rental/deur/types";
import type { RentalEquipmentLine } from "@/features/rental/equipment-line/types";
import type { WorkDescriptionRecord } from "@/features/masters/work-description/types";
import type { RemoteAuthenticationProvider } from "@/features/auth/providers/RemoteAuthenticationProvider";
import type { OperatorPinCredentialService } from "@/features/auth/services/OperatorPinCredentialService";
import type { RemoteUserAdministration } from "@/features/users/services/RemoteUserAdministration";
import type { CanonicalAuditEvent } from "@/features/administration/domain/canonicalAudit";
import type { CertificationTypeRecord, CertificationTypeCommandRepository } from "@/features/masters/certification-type/types";
import type { DeurCommandRepository } from "@/features/rental/deur/commands/contracts";
import type { OperationalCommandRepositories } from "@/features/rental/operations/commands/contracts";
import type { CanonicalRentalRemoteRepository } from "@/features/rental/remote/contracts";
import type { AssignmentCommandRepository } from "@/features/assignment/commands/contracts";
import type { ProjectCommandRepository } from "@/features/project/commands/contracts";
import type { OperatorCommandRepository } from "@/features/operators/commands/contracts";
import type { EquipmentCommandRepository } from "@/features/equipment/commands/contracts";
import type { CustomerCommandRepository } from "@/features/customer/commands/contracts";
import type { OperatorCertificationRepository } from "@/features/operators/certifications/repository";
import type { EquipmentSubcategoryCommandRepository, EquipmentSubcategoryReadRepository, EquipmentCategoryReadRepository } from "@/features/masters/equipment-subcategory/canonical";
import type { EquipmentMaintenanceSnapshotRepository } from "@/features/maintenance/canonical";
import type { EquipmentRentalLifecycleHistoryRepository } from "@/features/rental/history/canonical";
import type { EquipmentLifecycleSummaryRepository } from "@/features/equipment/history/canonical";
import type { CanonicalBookingReadRepository } from "@/features/booking/canonical";
import type { EquipmentAvailabilityRepository } from "@/features/equipment/availability/canonical";
import type {
  OperationalEventRepository,
  OperationalEventStream,
  OperationalEventTransport,
  OperatorSynchronizationService,
  OfflineOperationalCommandQueue,
  ReplayCoordinator,
  WorkspaceSynchronization,
} from "@/features/rental/realtime";

export interface RepositoryDependencies {
  equipment: IEquipmentRepository; assignment: typeof assignmentRepository; rental: IRentalRepository;
  rentalContract: typeof rentalContractRepository; rentalEquipmentLine: typeof rentalEquipmentLineRepository;
  deur: Pick<typeof deurRepository, "getAll" | "getById" | "getByRentalId" | "update" | "unlockBilling">; billingStatement: Pick<typeof billingStatementRepository, "getAll" | "getById" | "getByRentalId" | "search" | "create" | "update" | "delete">; prefix: typeof prefixRepository;
  costCode: typeof costCodeRepository; activityCode: typeof activityCodeRepository; deurShiftWindow: typeof deurShiftWindowRepository;
  equipmentStatusRead: ReadOnlyEquipmentStatusRepository;
}
export type EquipmentStatusSource="local"|"supabase";
export enum PersistenceMode { Local = "local", Remote = "remote" }
export interface ApplicationReadRepositories {
  users: ReadOnlyRepository<User>; equipment: ReadOnlyRepository<EquipmentRecord>; rentals: ReadOnlyRepository<RentalRecord>;
  assignments: ReadOnlyRepository<AssignmentRecord>; operators: ReadOnlyRepository<Operator>; customers: ReadOnlyRepository<CustomerRecord>;
  projects: ReadOnlyRepository<ProjectRecord>; billing: ReadOnlyRepository<BillingStatement>; deurs: ReadOnlyRepository<DeurRecord>;
  rentalEquipmentLines: ReadOnlyRepository<RentalEquipmentLine>;
  workDescriptions: ReadOnlyRepository<WorkDescriptionRecord>;
  canonicalAudit: ReadOnlyRepository<CanonicalAuditEvent>;
  certificationTypes: ReadOnlyRepository<CertificationTypeRecord>;
  equipmentSubcategories: EquipmentSubcategoryReadRepository;
  equipmentCategories: EquipmentCategoryReadRepository;
  maintenance: EquipmentMaintenanceSnapshotRepository;
  rentalLifecycleHistory: EquipmentRentalLifecycleHistoryRepository;
  lifecycleSummary: EquipmentLifecycleSummaryRepository;
  canonicalBookings: CanonicalBookingReadRepository;
  equipmentAvailability: EquipmentAvailabilityRepository;
  operatorCertifications: OperatorCertificationRepository;
}
export interface ApplicationCommandRepositories extends OperationalCommandRepositories { deurCommands: DeurCommandRepository; canonicalRental?: CanonicalRentalRemoteRepository; canonicalAssignment?: AssignmentCommandRepository; canonicalProject?: ProjectCommandRepository; canonicalOperator?: OperatorCommandRepository; canonicalEquipment?: EquipmentCommandRepository; canonicalCustomer?: CustomerCommandRepository; certificationTypes?: CertificationTypeCommandRepository; equipmentSubcategories?: EquipmentSubcategoryCommandRepository; operatorCertifications?: OperatorCertificationRepository }
export interface ApplicationChangeNotifications { subscribeDeur(listener: (record: DeurRecord) => void): () => void }
export interface OperationalSynchronizationDependencies {
  readonly tenantId?: string;
  readonly publishEnabled: boolean;
  readonly transportMode: "local" | "polling" | "realtime-with-polling-recovery";
  repository: OperationalEventRepository;
  transport: OperationalEventTransport;
  stream: OperationalEventStream;
  operator: OperatorSynchronizationService;
  workspace: WorkspaceSynchronization;
  offlineQueue: OfflineOperationalCommandQueue;
  replayCoordinator: ReplayCoordinator;
}
export interface AuthenticationDependencies {
  authRepository: AuthRepository;
  authenticationProviders: readonly AuthenticationProvider[];
  userRepository: UserRepository;
  authenticationService: AuthenticationService;
  authorizationService: AuthorizationService;
  legacyCompatibilityRepository: LegacyAuthCompatibilityRepository;
  userManagementService: UserManagementService;
  remoteAuthenticationProvider?: RemoteAuthenticationProvider;
  operatorPinCredentialService?: OperatorPinCredentialService;
  remoteUserAdministration?: RemoteUserAdministration;
}
export interface ApplicationDependencies { persistence: PersistenceAdapter; repositories: RepositoryDependencies; readRepositories: ApplicationReadRepositories; commandRepositories: ApplicationCommandRepositories; changeNotifications: ApplicationChangeNotifications; synchronization: OperationalSynchronizationDependencies; authentication: AuthenticationDependencies; configuration:{equipmentStatusSource:EquipmentStatusSource;persistenceMode:PersistenceMode;remoteOperationalWritesEnabled:boolean;remoteEquipmentCreateEnabled?:boolean;remoteRentalCreateEnabled?:boolean;remoteRentalCommercialTermsEnabled?:boolean;remoteRentalApprovalEnabled?:boolean;remoteRentalReserveEnabled?:boolean;remoteRentalReleaseEnabled?:boolean;remoteRentalActivateEnabled?:boolean;remoteRentalReturnEnabled?:boolean;remoteAssignmentCreateEnabled?:boolean;remoteAssignmentCancelEnabled?:boolean;remoteProjectCustomerLinkEnabled?:boolean}; compatibility: { sharedLegacySingletons: readonly (keyof RepositoryDependencies)[] } }
export type ApplicationDependencyOverrides = { persistence?: PersistenceAdapter; repositories?: Partial<RepositoryDependencies>; synchronization?: OperationalSynchronizationDependencies; authentication?: Partial<AuthenticationDependencies> };
