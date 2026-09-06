import type { SupabaseClient } from "@supabase/supabase-js";

import { repositoryFailure, repositorySuccess, type RepositoryResult } from "@/core/persistence";
import type { EquipmentAvailabilityInput, EquipmentAvailabilityRepository, EquipmentAvailabilityResult, EquipmentCommitmentRow, EquipmentCommitmentSearchInput, EquipmentCommitmentSearchResult, EquipmentCommitmentSource } from "@/features/equipment/availability/canonical";

type RpcClient = Pick<SupabaseClient, "schema">;
const defaultLimit = 25;
const maximumLimit = 100;
const maximumWindowDays = 93;
const sourceTypes = new Set<EquipmentCommitmentSource>(["RENTAL", "ASSIGNMENT", "RESTRICTED"]);
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const integer = (value: unknown): number | undefined => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
const boundedLimit = (value: number | undefined) => Number.isFinite(value) ? Math.max(1, Math.min(maximumLimit, Math.trunc(value as number))) : defaultLimit;
const boundedOffset = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const validWindow = (start: string, end: string) => validDate(start) && validDate(end) && start <= end && (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000 + 1 <= maximumWindowDays;

function mapRow(value: unknown): EquipmentCommitmentRow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const equipmentId = text(row.equipment_id);
  if (!equipmentId) return undefined;
  const source = text(row.source_type);
  if (source && !sourceTypes.has(source as EquipmentCommitmentSource)) return undefined;
  return {
    equipmentId,
    ...(text(row.equipment_asset_number) ? { equipmentAssetNumber: text(row.equipment_asset_number) } : {}),
    ...(text(row.equipment_name) ? { equipmentName: text(row.equipment_name) } : {}),
    ...(source ? { sourceType: source as EquipmentCommitmentSource } : {}),
    ...(text(row.status) ? { status: text(row.status) } : {}),
    ...(text(row.rental_number) ? { rentalNumber: text(row.rental_number) } : {}),
    ...(text(row.project_label) ? { projectLabel: text(row.project_label) } : {}),
    ...(text(row.customer_label) ? { customerLabel: text(row.customer_label) } : {}),
    ...(text(row.commitment_start) ? { commitmentStart: text(row.commitment_start) } : {}),
    ...(text(row.commitment_end) ? { commitmentEnd: text(row.commitment_end) } : {}),
    ...(typeof row.is_open_ended === "boolean" ? { isOpenEnded: row.is_open_ended } : {}),
  };
}

function invalidWindow<T>(): RepositoryResult<T> {
  return repositoryFailure("INVALID_AVAILABILITY_WINDOW", "Choose an inclusive availability window of no more than 93 days.", {
    context: { repository: "EquipmentAvailability" }, recoverability: "USER_ACTION_REQUIRED", recommendedAction: "Choose a valid, shorter business-date period.",
  });
}

export class SupabaseEquipmentAvailabilityRepository implements EquipmentAvailabilityRepository {
  constructor(private readonly client: RpcClient) {}

  async checkEquipmentAvailability(input: EquipmentAvailabilityInput): Promise<RepositoryResult<EquipmentAvailabilityResult>> {
    if (!text(input.equipmentId) || !validWindow(input.windowStart, input.windowEnd)) return invalidWindow();
    const { data, error } = await this.client.schema("erp").rpc("check_equipment_availability", {
      p_equipment_id: input.equipmentId, p_window_start: input.windowStart, p_window_end: input.windowEnd,
    });
    if (error || !Array.isArray(data) || data.length === 0) return remoteFailure();
    const rows = data.map(mapRow);
    if (rows.some((row) => !row)) return malformed();
    const first = data[0] as Record<string, unknown>;
    if (typeof first.available !== "boolean" || integer(first.conflict_count) === undefined) return malformed();
    return repositorySuccess({ equipmentId: input.equipmentId, available: first.available, conflictCount: integer(first.conflict_count) ?? 0, conflicts: rows.filter((row) => row?.sourceType) as EquipmentCommitmentRow[] });
  }

  async searchEquipmentCommitments(input: EquipmentCommitmentSearchInput): Promise<RepositoryResult<EquipmentCommitmentSearchResult>> {
    if (!validWindow(input.windowStart, input.windowEnd)) return invalidWindow();
    const limit = boundedLimit(input.limit), offset = boundedOffset(input.offset);
    const { data, error } = await this.client.schema("erp").rpc("search_equipment_commitment_conflicts", {
      p_window_start: input.windowStart, p_window_end: input.windowEnd, p_equipment_id: text(input.equipmentId) ?? null,
      p_project_id: text(input.projectId) ?? null, p_customer_id: text(input.customerId) ?? null, p_offset: offset, p_limit: limit,
    });
    if (error || !Array.isArray(data)) return remoteFailure();
    const rows = data.map(mapRow);
    if (rows.some((row) => !row)) return malformed();
    const first = data[0] as Record<string, unknown> | undefined;
    const totalCount = integer(first?.total_count) ?? 0;
    return repositorySuccess({ rows: rows as EquipmentCommitmentRow[], totalCount, offset, limit, hasMore: offset + rows.length < totalCount });
  }
}

function remoteFailure<T>(): RepositoryResult<T> {
  return repositoryFailure("REMOTE_READ_FAILED", "Canonical equipment availability could not be loaded.", { context: { repository: "EquipmentAvailability" }, recoverability: "RETRYABLE", recommendedAction: "Retry the request." });
}
function malformed<T>(): RepositoryResult<T> {
  return repositoryFailure("REMOTE_ROW_MALFORMED", "Canonical equipment availability could not be read safely.", { context: { repository: "EquipmentAvailability" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical availability read projection." });
}
