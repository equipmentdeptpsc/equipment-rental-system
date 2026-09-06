import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/Assignments/index.tsx", "utf8");

describe("canonical Booking list UI", () => {
  it("provides separate List, Calendar, and Agenda views backed by the calendar repository", () => {
    expect(source).toContain('type RentalBookingView = "list" | "calendar" | "agenda"');
    expect(source).toContain('aria-label="Rental booking views"');
    expect(source).toContain("searchCanonicalBookingCalendarRows");
    expect(source).toContain("windowStart");
    expect(source).toContain("windowEnd");
    expect(source).toContain("No rental bookings in this period");
  });
  it("keeps calendar reads bounded and uses authoritative return precedence", () => {
    expect(source).toContain("limit: 100");
    expect(source).toContain("row.actualReturn ?? row.expectedReturn ?? row.dateOut");
    expect(source).toContain("Previous month");
    expect(source).toContain("Next month");
    expect(source).toContain("to={`/rentals/${row.rentalId}`}");
    expect(source).not.toContain("created_at");
  });
  it("keeps Assignment compatibility and adds a separate Rental Bookings view", () => {
    expect(source).toContain('>Assignments</button>');
    expect(source).toContain('>Rental Bookings</button>');
    expect(source).toContain("readRepositories.canonicalBookings.searchCanonicalBookingRows");
    expect(source).toContain("One row per Rental Equipment Line");
  });

  it("uses server predicates and bounded pagination rather than local post-filtering", () => {
    expect(source).toContain("offset: 0");
    expect(source).toContain("limit: 25");
    expect(source).toContain("filters.status");
    expect(source).toContain("filters.rentalNumberSearch");
    expect(source).toContain("hasMore");
  });

  it("keeps secondary labels permission-gated and exposes navigation only", () => {
    expect(source).toContain('hasPermission("customer.read")');
    expect(source).toContain('hasPermission("project.read")');
    expect(source).toContain('hasPermission("equipment.read")');
    expect(source).toContain("Open Rental");
    expect(source).not.toContain("Return Equipment");
  });

  it("loads filter options independently from bounded canonical readers", () => {
    expect(source).toContain("readRepositories.customers.list({");
    expect(source).toContain("readRepositories.projects.list({");
    expect(source).toContain("readRepositories.equipment.list({");
    expect(source).not.toContain("const options = page?.rows");
  });
});
