import { repositoryFailure, repositorySuccess, type RepositoryResult } from "@/core/persistence";

export type EquipmentCommitmentSource = "RENTAL" | "ASSIGNMENT" | "RESTRICTED";

export interface EquipmentAvailabilityInput {
  equipmentId: string;
  windowStart: string;
  windowEnd: string;
}

export interface EquipmentCommitmentRow {
  equipmentId: string;
  equipmentAssetNumber?: string;
  equipmentName?: string;
  sourceType?: EquipmentCommitmentSource;
  status?: string;
  rentalNumber?: string;
  projectLabel?: string;
  customerLabel?: string;
  commitmentStart?: string;
  commitmentEnd?: string;
  isOpenEnded?: boolean;
}

export interface EquipmentAvailabilityResult {
  equipmentId: string;
  available: boolean;
  conflictCount: number;
  conflicts: readonly EquipmentCommitmentRow[];
}

export interface EquipmentCommitmentSearchInput {
  windowStart: string;
  windowEnd: string;
  equipmentId?: string;
  projectId?: string;
  customerId?: string;
  offset?: number;
  limit?: number;
}

export interface EquipmentCommitmentSearchResult {
  rows: readonly EquipmentCommitmentRow[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface EquipmentAvailabilityRepository {
  checkEquipmentAvailability(input: EquipmentAvailabilityInput): Promise<RepositoryResult<EquipmentAvailabilityResult>>;
  searchEquipmentCommitments(input: EquipmentCommitmentSearchInput): Promise<RepositoryResult<EquipmentCommitmentSearchResult>>;
}

/** Local mode must never become an authority for remote canonical availability. */
export class LocalEquipmentAvailabilityRepository implements EquipmentAvailabilityRepository {
  async checkEquipmentAvailability(): Promise<RepositoryResult<EquipmentAvailabilityResult>> {
    return unavailable();
  }

  async searchEquipmentCommitments(): Promise<RepositoryResult<EquipmentCommitmentSearchResult>> {
    return unavailable();
  }
}

function unavailable<T>(): RepositoryResult<T> {
  return repositoryFailure("REMOTE_AVAILABILITY_READ_UNAVAILABLE", "Canonical equipment availability is available only in remote mode.", {
    context: { repository: "EquipmentAvailability" }, recoverability: "USER_ACTION_REQUIRED", recommendedAction: "Use an authenticated remote environment.",
  });
}

export function emptyEquipmentCommitmentSearch(limit = 25): RepositoryResult<EquipmentCommitmentSearchResult> {
  return repositorySuccess({ rows: [], totalCount: 0, offset: 0, limit, hasMore: false });
}
