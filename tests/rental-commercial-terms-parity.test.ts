import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync("src/app/router.tsx", "utf8");
const page = readFileSync("src/pages/Rental/CommercialTerms.tsx", "utf8");
const remotePage = readFileSync("src/features/rental/remote/RemoteCommercialTermsPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260907000400_align_rental_commercial_terms_update_permission.sql", "utf8");

describe("Commercial Terms Catalog 2.0 parity", () => {
  it("permits canonical reads without the deprecated aggregate permission", () => {
    expect(router).toContain('permitted("rental.commercialTerms.read", <RentalCommercialTermsPage />)');
    expect(page).toContain("<RemoteCommercialTermsPage rentalId={rentalId}/>");
    expect(remotePage).toContain('hasPermission("rental.commercialTerms.update")');
    expect(remotePage).toContain("Commercial Terms are read-only.");
    expect(remotePage).toContain("disabled={!editable}");
  });

  it("uses the granular update permission at the canonical server boundary", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp.command_update_draft_rental_terms(command jsonb)");
    expect(migration).toContain("erp.current_company_id()");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("current_user_has_permission('rental.commercialTerms.update')");
    expect(migration).not.toContain("rental.commercialTerms.manage");
    for (const invariant of ["FOR UPDATE", "expectedVersion", "begin_operational_command", "RENTAL_TERMS_UPDATED", "finish_operational_command", "GRANT EXECUTE ON FUNCTION erp.command_update_draft_rental_terms(jsonb) TO authenticated"]) expect(migration).toContain(invariant);
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON/i);
  });
});
