import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCanonicalBookingReadRepository } from "@/integrations/supabase/SupabaseCanonicalBookingReadRepository";

const migration = readFileSync("supabase/migrations/20260906000100_booking_operational_read_projection.sql", "utf8");
const row = { rental_id: "r1", rental_number: "R-1", rental_status: "Reserved", rental_equipment_line_id: "l1", equipment_id: "e1", date_out: "2026-09-08", created_at: "2026-09-01T00:00:00Z", total_count: 2 };

describe("canonical Booking operational read projection", () => {
  it("defines server-owned eligibility, inclusive bounded windows, and permission-safe shared projection", () => {
    for (const token of [
      "erp.search_upcoming_release_rows", "erp.search_expected_return_rows", "erp._search_booking_rows_v2",
      "rental.status = 'Reserved'", "line.status = 'Reserved'", "rental.legacy_payload->>'approvalStatus'", "= 'Approved'",
      "rental.status IN ('Released', 'Active')", "line.status IN ('Released', 'Active')", "rental.expected_return IS NOT NULL",
      "rental.date_out BETWEEN p_window_start AND p_window_end", "rental.expected_return BETWEEN p_window_start AND p_window_end",
      "p_window_end - p_window_start > 92", "current_user_has_permission('rental.read')", "erp.can_read_company_row(rental.company_id)",
      "current_user_has_permission('equipment.read')", "current_user_has_permission('customer.read')", "current_user_has_permission('project.read')",
      "LEAST(100, GREATEST(1, COALESCE(p_limit, 25)))", "OFFSET v_offset", "LIMIT v_limit",
      "p_operational_queue = 'UPCOMING_RELEASE'", "p_operational_queue = 'EXPECTED_RETURN'", "REVOKE ALL ON FUNCTION erp.search_upcoming_release_rows", "REVOKE ALL ON FUNCTION erp.search_expected_return_rows",
    ]) expect(migration).toContain(token);
    expect(migration).toContain("RETURN QUERY SELECT * FROM erp._search_booking_rows_v2");
    expect(migration).not.toMatch(/company_id\s+(?:text|uuid)\s*(?:DEFAULT)?/i);
    expect(migration).not.toMatch(/INSERT INTO|UPDATE erp\.|DELETE FROM|CREATE TABLE[^;]*booking/i);
  });

  it("keeps existing public List and Calendar contract signatures while adding dedicated operational RPCs", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp._search_booking_rows(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp.search_booking_calendar_rows(");
    expect(migration).toContain("p_status text DEFAULT NULL");
    expect(migration).toContain("p_order_field text DEFAULT 'dateOut'");
    expect(migration).toContain("p_operational_queue IS NULL");
  });

  it("calls dedicated RPCs with only bounded canonical filters and paging", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const repository = new SupabaseCanonicalBookingReadRepository({ schema: vi.fn(() => ({ rpc })) } as never);
    const input = { windowStart: "2026-09-06", windowEnd: "2026-09-12", customerId: "c1", projectId: "p1", equipmentId: "e1", rentalNumberSearch: "R-", offset: -1, limit: 101 };

    await expect(repository.searchCanonicalUpcomingReleaseRows(input)).resolves.toMatchObject({ success: true });
    expect(rpc).toHaveBeenLastCalledWith("search_upcoming_release_rows", {
      p_window_start: "2026-09-06", p_window_end: "2026-09-12", p_customer_id: "c1", p_project_id: "p1", p_equipment_id: "e1", p_rental_number_search: "R-", p_offset: 0, p_limit: 100,
    });
    await expect(repository.searchCanonicalExpectedReturnRows(input)).resolves.toMatchObject({ success: true });
    expect(rpc).toHaveBeenLastCalledWith("search_expected_return_rows", {
      p_window_start: "2026-09-06", p_window_end: "2026-09-12", p_customer_id: "c1", p_project_id: "p1", p_equipment_id: "e1", p_rental_number_search: "R-", p_offset: 0, p_limit: 100,
    });
  });

  it("rejects malformed, reversed, and oversized operational windows before any request", async () => {
    const rpc = vi.fn();
    const repository = new SupabaseCanonicalBookingReadRepository({ schema: vi.fn(() => ({ rpc })) } as never);
    for (const input of [
      { windowStart: "2026-09-08", windowEnd: "2026-09-07" },
      { windowStart: "2026-09-01", windowEnd: "2026-12-03" },
      { windowStart: "2026-02-30", windowEnd: "2026-03-01" },
    ]) await expect(repository.searchCanonicalExpectedReturnRows(input)).resolves.toMatchObject({ success: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
