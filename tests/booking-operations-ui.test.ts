import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/Assignments/index.tsx", "utf8");

describe("Rental Bookings operations UI", () => {
  it("exposes bounded Upcoming Releases and Expected Returns queues", () => {
    expect(source).toContain('"operations"');
    expect(source).toContain("Upcoming Releases");
    expect(source).toContain("Expected Returns");
    expect(source).toContain("searchCanonicalUpcomingReleaseRows");
    expect(source).toContain("searchCanonicalExpectedReturnRows");
    expect(source).toContain("Next 7 days");
    expect(source).toContain('value="14"');
    expect(source).toContain('value="30"');
    expect(source).toContain("limit: 25");
    expect(source).toContain("No upcoming releases in this period");
    expect(source).toContain("No expected returns in this period");
  });

  it("keeps queue failures local and navigation read-only", () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain("Retry");
    expect(source).toContain("Open Rental");
    expect(source).toContain("No records match the selected filters");
    expect(source).not.toContain(">Reserve</button>");
    expect(source).not.toContain(">Activate</button>");
    expect(source).not.toContain(">Return</button>");
  });
});
