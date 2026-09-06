import type { SupabaseClient } from "@supabase/supabase-js";

import { repositoryFailure, repositorySuccess, type RepositoryResult } from "@/core/persistence";
import { canonicalBookingStatuses, type CanonicalBookingCalendarSearchInput, type CanonicalBookingListItem, type CanonicalBookingOperationalSearchInput, type CanonicalBookingPage, type CanonicalBookingReadRepository, type CanonicalBookingSearchInput, type CanonicalBookingSort } from "@/features/booking/canonical";

type RpcClient = Pick<SupabaseClient, "schema">;
const statuses = new Set<string>(canonicalBookingStatuses);
const sorts = new Set<CanonicalBookingSort>(["createdAt", "dateOut", "expectedReturn", "rentalStatus"]);
const defaultLimit = 25;
const maximumLimit = 100;
const maximumCalendarWindowDays = 93;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const boundedLimit = (value: number | undefined) => Number.isFinite(value) ? Math.max(1, Math.min(maximumLimit, Math.trunc(value as number))) : defaultLimit;
const boundedOffset = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const calendarWindowIsValid = (start: string, end: string) => {
  if (!validDate(start) || !validDate(end) || start > end) return false;
  const startAt = Date.parse(`${start}T00:00:00.000Z`), endAt = Date.parse(`${end}T00:00:00.000Z`);
  return (endAt - startAt) / 86_400_000 + 1 <= maximumCalendarWindowDays;
};

function mapRow(value: unknown): CanonicalBookingListItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const rentalId = text(row.rental_id), lineId = text(row.rental_equipment_line_id), equipmentId = text(row.equipment_id), status = text(row.rental_status), dateOut = text(row.date_out), createdAt = text(row.created_at);
  if (!rentalId || !lineId || !equipmentId || !status || !statuses.has(status) || !dateOut || !createdAt) return undefined;
  return {
    rentalId, rentalEquipmentLineId: lineId, equipmentId, rentalStatus: status as CanonicalBookingListItem["rentalStatus"], dateOut, createdAt,
    ...(text(row.rental_number) ? { rentalNumber: text(row.rental_number) } : {}),
    ...(text(row.equipment_asset_number) ? { equipmentAssetNumber: text(row.equipment_asset_number) } : {}),
    ...(text(row.equipment_name) ? { equipmentName: text(row.equipment_name) } : {}),
    ...(text(row.customer_id) ? { customerId: text(row.customer_id) } : {}),
    ...(text(row.customer_name) ? { customerName: text(row.customer_name) } : {}),
    ...(text(row.project_id) ? { projectId: text(row.project_id) } : {}),
    ...(text(row.project_name) ? { projectName: text(row.project_name) } : {}),
    ...(text(row.expected_return) ? { expectedReturn: text(row.expected_return) } : {}), ...(text(row.actual_return) ? { actualReturn: text(row.actual_return) } : {}),
    ...(text(row.reserved_at) ? { reservedAt: text(row.reserved_at) } : {}), ...(text(row.released_at) ? { releasedAt: text(row.released_at) } : {}),
    ...(text(row.activated_at) ? { activatedAt: text(row.activated_at) } : {}), ...(text(row.returned_at) ? { returnedAt: text(row.returned_at) } : {}),
    ...(text(row.closed_at) ? { closedAt: text(row.closed_at) } : {}), ...(text(row.cancelled_at) ? { cancelledAt: text(row.cancelled_at) } : {}),
  };
}

export class SupabaseCanonicalBookingReadRepository implements CanonicalBookingReadRepository {
  constructor(private readonly client: RpcClient) {}

  async searchCanonicalBookingRows(input: CanonicalBookingSearchInput = {}): Promise<RepositoryResult<CanonicalBookingPage>> {
    const limit = boundedLimit(input.limit), offset = boundedOffset(input.offset), sort = input.sort && sorts.has(input.sort) ? input.sort : "createdAt";
    const { data, error } = await this.client.schema("erp").rpc("search_booking_rows", {
      p_status: input.status && statuses.has(input.status) ? input.status : null,
      p_customer_id: text(input.customerId) ?? null, p_project_id: text(input.projectId) ?? null, p_equipment_id: text(input.equipmentId) ?? null,
      p_rental_number_search: text(input.rentalNumberSearch) ?? null, p_order_field: sort, p_order_ascending: input.ascending === true,
      p_offset: offset, p_limit: limit,
    });
    if (error || !Array.isArray(data)) return repositoryFailure("REMOTE_READ_FAILED", "Canonical Rental Bookings could not be loaded.", { context: { repository: "CanonicalBooking" }, recoverability: "RETRYABLE", recommendedAction: "Retry the request." });
    const rows = data.map(mapRow);
    if (rows.some((row) => !row)) return repositoryFailure("REMOTE_ROW_MALFORMED", "Canonical Rental Bookings could not be read safely.", { context: { repository: "CanonicalBooking" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical Booking read projection." });
    const first = data[0] as Record<string, unknown> | undefined, totalCount = typeof first?.total_count === "number" && first.total_count >= 0 ? first.total_count : 0;
    return repositorySuccess({ rows: rows as CanonicalBookingListItem[], totalCount, offset, limit, hasMore: offset + rows.length < totalCount });
  }

  async searchCanonicalBookingCalendarRows(input: CanonicalBookingCalendarSearchInput): Promise<RepositoryResult<CanonicalBookingPage>> {
    if (!calendarWindowIsValid(input.windowStart, input.windowEnd)) return repositoryFailure("INVALID_CALENDAR_WINDOW", "Choose an inclusive calendar window of no more than 93 days.", {
      context: { repository: "CanonicalBooking" }, recoverability: "USER_ACTION_REQUIRED", recommendedAction: "Choose a valid, shorter calendar period.",
    });
    const limit = boundedLimit(input.limit), offset = boundedOffset(input.offset), sort = input.sort && sorts.has(input.sort) ? input.sort : "dateOut";
    const { data, error } = await this.client.schema("erp").rpc("search_booking_calendar_rows", {
      p_window_start: input.windowStart, p_window_end: input.windowEnd,
      p_status: input.status && statuses.has(input.status) ? input.status : null,
      p_customer_id: text(input.customerId) ?? null, p_project_id: text(input.projectId) ?? null, p_equipment_id: text(input.equipmentId) ?? null,
      p_rental_number_search: text(input.rentalNumberSearch) ?? null, p_order_field: sort, p_order_ascending: input.ascending ?? true,
      p_offset: offset, p_limit: limit,
    });
    if (error || !Array.isArray(data)) return repositoryFailure("REMOTE_READ_FAILED", "Canonical Rental Bookings could not be loaded.", { context: { repository: "CanonicalBooking" }, recoverability: "RETRYABLE", recommendedAction: "Retry the request." });
    const rows = data.map(mapRow);
    if (rows.some((row) => !row)) return repositoryFailure("REMOTE_ROW_MALFORMED", "Canonical Rental Bookings could not be read safely.", { context: { repository: "CanonicalBooking" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical Booking read projection." });
    const first = data[0] as Record<string, unknown> | undefined, totalCount = typeof first?.total_count === "number" && first.total_count >= 0 ? first.total_count : 0;
    return repositorySuccess({ rows: rows as CanonicalBookingListItem[], totalCount, offset, limit, hasMore: offset + rows.length < totalCount });
  }

  async searchCanonicalUpcomingReleaseRows(input: CanonicalBookingOperationalSearchInput): Promise<RepositoryResult<CanonicalBookingPage>> {
    return this.searchOperationalRows("search_upcoming_release_rows", input);
  }

  async searchCanonicalExpectedReturnRows(input: CanonicalBookingOperationalSearchInput): Promise<RepositoryResult<CanonicalBookingPage>> {
    return this.searchOperationalRows("search_expected_return_rows", input);
  }

  private async searchOperationalRows(rpcName: "search_upcoming_release_rows" | "search_expected_return_rows", input: CanonicalBookingOperationalSearchInput): Promise<RepositoryResult<CanonicalBookingPage>> {
    if (!calendarWindowIsValid(input.windowStart, input.windowEnd)) return repositoryFailure("INVALID_OPERATIONAL_WINDOW", "Choose an inclusive operational window of no more than 93 days.", {
      context: { repository: "CanonicalBooking" }, recoverability: "USER_ACTION_REQUIRED", recommendedAction: "Choose a valid, shorter calendar period.",
    });
    const limit = boundedLimit(input.limit), offset = boundedOffset(input.offset);
    const { data, error } = await this.client.schema("erp").rpc(rpcName, {
      p_window_start: input.windowStart, p_window_end: input.windowEnd,
      p_customer_id: text(input.customerId) ?? null, p_project_id: text(input.projectId) ?? null, p_equipment_id: text(input.equipmentId) ?? null,
      p_rental_number_search: text(input.rentalNumberSearch) ?? null, p_offset: offset, p_limit: limit,
    });
    if (error || !Array.isArray(data)) return repositoryFailure("REMOTE_READ_FAILED", "Operational Rental Bookings could not be loaded.", { context: { repository: "CanonicalBooking" }, recoverability: "RETRYABLE", recommendedAction: "Retry the request." });
    const rows = data.map(mapRow);
    if (rows.some((row) => !row)) return repositoryFailure("REMOTE_ROW_MALFORMED", "Operational Rental Bookings could not be read safely.", { context: { repository: "CanonicalBooking" }, recoverability: "MANUAL_RECONCILIATION", recommendedAction: "Repair the canonical Booking read projection." });
    const first = data[0] as Record<string, unknown> | undefined, totalCount = typeof first?.total_count === "number" && first.total_count >= 0 ? first.total_count : 0;
    return repositorySuccess({ rows: rows as CanonicalBookingListItem[], totalCount, offset, limit, hasMore: offset + rows.length < totalCount });
  }
}
