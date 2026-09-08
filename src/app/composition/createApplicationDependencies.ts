import { repositoryFailure } from "@/core/persistence";
import { createRemoteCapabilities,createRemoteCore,readRemoteConfiguration,validateSupabaseConfiguration,type RemoteRuntimeConfiguration } from "@/core/remote";
import { getSupabaseBrowserClient } from "@/integrations/supabase/browserClient";
import { SupabaseEquipmentStatusReadRepository,type ReadOnlyEquipmentStatusRepository } from "@/features/masters/equipment-status/repository";
import type { ApplicationDependencies,ApplicationDependencyOverrides,EquipmentStatusSource } from "./ApplicationDependencies";
import { createLocalApplicationDependencies } from "./createLocalApplicationDependencies";
import { createSupabaseReadRepositories } from "@/integrations/supabase/readRepositories";
import { SupabaseCertificationCommandRepository } from "@/integrations/supabase/SupabaseCertificationRepository";
import { SupabaseAuthenticationProvider } from "@/integrations/supabase/SupabaseAuthenticationProvider";
import { PersistenceMode } from "./ApplicationDependencies";
import { SupabaseDeurCommandRepository } from "@/integrations/supabase/SupabaseDeurCommandRepository";
import type { DeurCommandRepository, DeurLifecycleCommandResult } from "@/features/rental/deur/commands/contracts";
import { createDisabledRemoteOperationalCommands,createUnavailableOperationalCommands } from "@/features/rental/operations/commands/UnavailableOperationalCommandRepository";
import { createSupabaseOperationalCommands, createSupabaseRentalReturnCommands } from "@/integrations/supabase/SupabaseOperationalCommandRepository";
import { SupabaseOperationalEventRepository } from "@/integrations/supabase/SupabaseOperationalEventRepository";
import { SupabaseOperationalRealtimeSource } from "@/integrations/supabase/SupabaseOperationalRealtimeSource";
import { SupabaseRemoteUserAdministration } from "@/integrations/supabase/SupabaseRemoteUserAdministration";
import { BrowserReplayCoordinator,IndexedDbOfflineOperationalCommandQueue,InMemoryOfflineOperationalCommandQueue,OperationalEventStream,OperatorSynchronizationService,PollingOperationalEventTransport,RealtimeOperationalEventTransport,WorkspaceSynchronization } from "@/features/rental/realtime";
import { SupabaseCanonicalRentalRepository } from "@/integrations/supabase/SupabaseCanonicalRentalRepository";
import { SupabaseAssignmentCommandRepository } from "@/integrations/supabase/SupabaseAssignmentCommandRepository";
import { SupabaseProjectCommandRepository } from "@/integrations/supabase/SupabaseProjectCommandRepository";
import { SupabaseOperatorCommandRepository } from "@/integrations/supabase/SupabaseOperatorCommandRepository";
import { SupabaseEquipmentCommandRepository } from "@/integrations/supabase/SupabaseEquipmentCommandRepository";
import { SupabaseCustomerCommandRepository } from "@/integrations/supabase/SupabaseCustomerCommandRepository";
import { SupabaseEquipmentSubcategoryRepository, SupabaseEquipmentCategoryReadRepository } from "@/integrations/supabase/SupabaseEquipmentSubcategoryRepository";
import { SupabaseEquipmentLifecycleSummaryRepository } from "@/integrations/supabase/SupabaseEquipmentLifecycleSummaryRepository";
import { resolveRuntimeEnvironment } from "./runtimeEnvironment";

export interface ApplicationRuntimeConfiguration { persistenceMode?:string;equipmentStatusSource?:string;supabaseUrl?:string;supabasePublishableKey?:string;remoteOperationalWritesEnabled?:boolean;remoteEquipmentCreateEnabled?:boolean;remoteRentalCreateEnabled?:boolean;remoteRentalCommercialTermsEnabled?:boolean;remoteRentalApprovalEnabled?:boolean;remoteRentalReserveEnabled?:boolean;remoteRentalReleaseEnabled?:boolean;remoteRentalActivateEnabled?:boolean;remoteRentalReturnEnabled?:boolean;remoteAssignmentCreateEnabled?:boolean;remoteAssignmentCancelEnabled?:boolean;remoteProjectCustomerLinkEnabled?:boolean;operationalReadTransport?:string }
export function normalizePersistenceMode(value: string | undefined): PersistenceMode {
  if (value === PersistenceMode.Remote || value === PersistenceMode.Local) return value;
  throw new Error("Invalid persistence mode configuration.");
}
class MissingRemoteConfigurationRepository implements ReadOnlyEquipmentStatusRepository{
  readonly capabilities=createRemoteCapabilities("ReadOnly","SupportsPaging","SupportsOrdering");
  private failure(){return repositoryFailure("SUPABASE_CONFIGURATION_MISSING","Supabase Equipment Status mode requires browser-safe project configuration.",{context:{repository:"EquipmentStatus",required:"VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY"},recoverability:"USER_ACTION_REQUIRED",recommendedAction:"Provide the Vite Supabase URL and publishable key, or set VITE_EQUIPMENT_STATUS_SOURCE=local."});}
  async list(){return this.failure();}async getById(){return this.failure();}
}
class MissingRemoteCommandConfiguration implements DeurCommandRepository {
  private failure():Promise<DeurLifecycleCommandResult>{return Promise.resolve({success:false,code:"TRANSPORT_FAILURE",message:"Remote persistence configuration is missing.",retryable:false,refreshRequired:false});}
  startShift(){return this.failure();}startOrChangeActivity(){return this.failure();}stopCurrentActivity(){return this.failure();}completeShift(){return this.failure();}submitDeur(){return this.failure();}
}
export function readApplicationRuntimeConfiguration():ApplicationRuntimeConfiguration{
  const resolution=resolveRuntimeEnvironment({persistenceMode:import.meta.env.VITE_PERSISTENCE_MODE,supabaseUrl:import.meta.env.VITE_SUPABASE_URL,supabasePublishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,hostname:typeof window==="undefined"?"localhost":window.location.hostname});
  if(resolution.kind==="configuration-error")throw new Error(resolution.message);
  const mode=normalizePersistenceMode(resolution.persistenceMode);const value=readRemoteConfiguration({VITE_SUPABASE_URL:import.meta.env.VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},mode===PersistenceMode.Remote?"supabase":import.meta.env.VITE_EQUIPMENT_STATUS_SOURCE);
  return{persistenceMode:mode,equipmentStatusSource:value.source,supabaseUrl:value.supabaseUrl,supabasePublishableKey:value.supabasePublishableKey,remoteOperationalWritesEnabled:import.meta.env.VITE_REMOTE_OPERATIONAL_WRITES_ENABLED==="true",remoteEquipmentCreateEnabled:import.meta.env.VITE_REMOTE_EQUIPMENT_CREATE_ENABLED==="true",remoteRentalCreateEnabled:import.meta.env.VITE_REMOTE_RENTAL_CREATE_ENABLED==="true",remoteRentalCommercialTermsEnabled:import.meta.env.VITE_REMOTE_RENTAL_COMMERCIAL_TERMS_ENABLED==="true",remoteRentalApprovalEnabled:import.meta.env.VITE_REMOTE_RENTAL_APPROVAL_ENABLED==="true",remoteRentalReserveEnabled:import.meta.env.VITE_REMOTE_RENTAL_RESERVE_ENABLED==="true",remoteRentalReleaseEnabled:import.meta.env.VITE_REMOTE_RENTAL_RELEASE_ENABLED==="true",remoteRentalActivateEnabled:import.meta.env.VITE_REMOTE_RENTAL_ACTIVATE_ENABLED==="true",remoteRentalReturnEnabled:import.meta.env.VITE_REMOTE_RENTAL_RETURN_ENABLED==="true",remoteAssignmentCreateEnabled:import.meta.env.VITE_REMOTE_ASSIGNMENT_CREATE_ENABLED==="true",remoteAssignmentCancelEnabled:import.meta.env.VITE_REMOTE_ASSIGNMENT_CANCEL_ENABLED==="true",remoteProjectCustomerLinkEnabled:import.meta.env.VITE_REMOTE_PROJECT_CUSTOMER_LINK_ENABLED==="true",operationalReadTransport:import.meta.env.VITE_OPERATIONAL_READ_TRANSPORT};
}
export function createApplicationDependencies(configuration:ApplicationRuntimeConfiguration=readApplicationRuntimeConfiguration(),overrides:ApplicationDependencyOverrides={}):ApplicationDependencies{
  const source:EquipmentStatusSource=configuration.persistenceMode==="remote"||configuration.equipmentStatusSource==="supabase"?"supabase":"local";
  if(source==="local")return createLocalApplicationDependencies(overrides);
  const remoteConfiguration:RemoteRuntimeConfiguration={source:"supabase",supabaseUrl:configuration.supabaseUrl,supabasePublishableKey:configuration.supabasePublishableKey};
  const validated=validateSupabaseConfiguration(remoteConfiguration);const remoteCore=createRemoteCore();
  const client=validated.success?getSupabaseBrowserClient(validated.value):undefined;
  const equipmentStatusRead=client?new SupabaseEquipmentStatusReadRepository(client,remoteCore):new MissingRemoteConfigurationRepository();
  const dependencies=createLocalApplicationDependencies({...overrides,repositories:{...overrides.repositories,equipmentStatusRead}});
  if(!client)return{...dependencies,commandRepositories:{deurCommands:new MissingRemoteCommandConfiguration(),...createUnavailableOperationalCommands()},changeNotifications:{subscribeDeur:()=>()=>{}},synchronization:{...dependencies.synchronization,tenantId:undefined,publishEnabled:false},configuration:{equipmentStatusSource:"supabase",persistenceMode:PersistenceMode.Remote,remoteOperationalWritesEnabled:false,remoteEquipmentCreateEnabled:false,remoteRentalCreateEnabled:false,remoteRentalCommercialTermsEnabled:false,remoteRentalApprovalEnabled:false,remoteRentalReserveEnabled:false,remoteRentalReleaseEnabled:false,remoteRentalActivateEnabled:false,remoteRentalReturnEnabled:false,remoteAssignmentCreateEnabled:false,remoteAssignmentCancelEnabled:false,remoteProjectCustomerLinkEnabled:false}};
  const readRepositories=createSupabaseReadRepositories(client,remoteCore);
  const remoteAuthenticationProvider=new SupabaseAuthenticationProvider(client,readRepositories.users);
  const operationalCommands=configuration.remoteOperationalWritesEnabled?createSupabaseOperationalCommands(client):createDisabledRemoteOperationalCommands();
  const rentalReturnCommands=configuration.remoteOperationalWritesEnabled||configuration.remoteRentalReturnEnabled===true?createSupabaseRentalReturnCommands(client):operationalCommands.rentalReturnCommands;
  operationalCommands.rentalReturnCommands = rentalReturnCommands;
  const eventRepository=new SupabaseOperationalEventRepository(client);
  const useRealtime=configuration.operationalReadTransport==="realtime-with-polling-recovery";
  const eventTransport=useRealtime
    ? new RealtimeOperationalEventTransport(new SupabaseOperationalRealtimeSource(client),eventRepository)
    : new PollingOperationalEventTransport(eventRepository);
  const eventStream=new OperationalEventStream(eventTransport);
  const synchronization={tenantId:"AUTHENTICATED_TENANT",publishEnabled:false,transportMode:(useRealtime?"realtime-with-polling-recovery":"polling") as "realtime-with-polling-recovery"|"polling",repository:eventRepository,transport:eventTransport,stream:eventStream,operator:new OperatorSynchronizationService(eventStream),workspace:new WorkspaceSynchronization(eventStream),offlineQueue:typeof indexedDB==="undefined"?new InMemoryOfflineOperationalCommandQueue():new IndexedDbOfflineOperationalCommandQueue(),replayCoordinator:new BrowserReplayCoordinator(typeof navigator!=="undefined"?navigator.locks:undefined)};
  const equipmentSubcategories=new SupabaseEquipmentSubcategoryRepository(client);
  const assignmentCommandsEnabled=configuration.remoteOperationalWritesEnabled===true||configuration.remoteAssignmentCreateEnabled===true||configuration.remoteAssignmentCancelEnabled===true;
  const projectCommandsEnabled=configuration.remoteOperationalWritesEnabled===true||configuration.remoteProjectCustomerLinkEnabled===true;
  const equipmentCreateEnabled=configuration.remoteOperationalWritesEnabled===true||configuration.remoteEquipmentCreateEnabled===true;
  return{...dependencies,readRepositories:{...readRepositories,equipmentSubcategories,equipmentCategories:new SupabaseEquipmentCategoryReadRepository(client),lifecycleSummary:new SupabaseEquipmentLifecycleSummaryRepository(client)},commandRepositories:{deurCommands:new SupabaseDeurCommandRepository(client,readRepositories.deurs),...operationalCommands,certificationTypes:new SupabaseCertificationCommandRepository(client),equipmentSubcategories,operatorCertifications:readRepositories.operatorCertifications,canonicalRental:new SupabaseCanonicalRentalRepository(client),...(assignmentCommandsEnabled?{canonicalAssignment:new SupabaseAssignmentCommandRepository(client)}:{}),...(projectCommandsEnabled?{canonicalProject:new SupabaseProjectCommandRepository(client)}:{}),...(configuration.remoteOperationalWritesEnabled?{canonicalOperator:new SupabaseOperatorCommandRepository(client),canonicalCustomer:new SupabaseCustomerCommandRepository(client)}:{}),...(equipmentCreateEnabled?{canonicalEquipment:new SupabaseEquipmentCommandRepository(client)}:{})},changeNotifications:{subscribeDeur:()=>()=>{}},synchronization,authentication:{...dependencies.authentication,remoteAuthenticationProvider,remoteUserAdministration:new SupabaseRemoteUserAdministration(client)},configuration:{equipmentStatusSource:"supabase",persistenceMode:PersistenceMode.Remote,remoteOperationalWritesEnabled:configuration.remoteOperationalWritesEnabled===true,remoteEquipmentCreateEnabled:configuration.remoteEquipmentCreateEnabled===true,remoteRentalCreateEnabled:configuration.remoteRentalCreateEnabled===true,remoteRentalCommercialTermsEnabled:configuration.remoteRentalCommercialTermsEnabled===true,remoteRentalApprovalEnabled:configuration.remoteRentalApprovalEnabled===true,remoteRentalReserveEnabled:configuration.remoteRentalReserveEnabled===true,remoteRentalReleaseEnabled:configuration.remoteRentalReleaseEnabled===true,remoteRentalActivateEnabled:configuration.remoteRentalActivateEnabled===true,remoteRentalReturnEnabled:configuration.remoteRentalReturnEnabled===true,remoteAssignmentCreateEnabled:configuration.remoteAssignmentCreateEnabled===true,remoteAssignmentCancelEnabled:configuration.remoteAssignmentCancelEnabled===true,remoteProjectCustomerLinkEnabled:configuration.remoteProjectCustomerLinkEnabled===true}};
}
