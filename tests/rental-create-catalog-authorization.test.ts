import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260906000400_align_canonical_rental_draft_create_permission.sql",
  "utf8",
);
const router = readFileSync("src/app/router.tsx", "utf8");
const newRental = readFileSync("src/pages/Rental/New.tsx", "utf8");
const rentalList = readFileSync("src/pages/Rental/index.tsx", "utf8");

describe("Catalog 2.0 canonical Rental create authorization", () => {
  it("uses rental.create for the new-rental route and remote entry points", () => {
    expect(router).toContain('path: "rentals/new", element: permitted("rental.create", <NewRental />)');
    expect(newRental).toContain('hasPermission("rental.create")');
    expect(rentalList).toContain('hasPermission("rental.create")');
  });

  it("repairs only the canonical draft-command permission without role changes", () => {
    expect(migration).toContain("erp.command_create_draft_rental(jsonb)");
    expect(migration).toContain("current_user_has_permission(''rental.create'')");
    expect(migration).toContain("current_user_has_permission(''rental.manage'')");
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+erp\.role_permissions/i);
    expect(migration).toContain("REVOKE ALL ON FUNCTION erp.command_create_draft_rental(jsonb)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION erp.command_create_draft_rental(jsonb) TO authenticated");
  });
});
