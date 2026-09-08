import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260908000400_add_rental_draft_review_contact_snapshot.sql", "utf8");
const definition = migration.replaceAll("''", "'");

describe("canonical Rental draft review-contact snapshot", () => {
  it("persists normalized Rental-owned review contact evidence at draft creation", () => {
    expect(migration).toContain("customer_review_name_snapshot,customer_review_email_snapshot,customer_review_contact_captured_at");
    expect(definition).toContain("btrim(command->>'representativeName')");
    expect(definition).toContain("lower(btrim(command->>'representativeEmail'))");
    expect(migration).toContain("now_at,actor,actor,tenant");
    expect(migration).not.toMatch(/UPDATE erp\.customers|INSERT INTO erp\.customers/);
  });

  it("rejects absent, malformed, oversized, and header-injection review contacts", () => {
    for (const marker of [
      "length(btrim(coalesce(command->>'representativeName',''))) NOT BETWEEN 1 AND 200",
      "btrim(coalesce(command->>'representativeName','')) ~ E'[\\\\r\\\\n]'",
      "length(lower(btrim(coalesce(command->>'representativeEmail','')))) NOT BETWEEN 3 AND 254",
      "lower(btrim(coalesce(command->>'representativeEmail',''))) ~ E'[\\\\r\\\\n]'",
      "lower(btrim(coalesce(command->>'representativeEmail',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\\\\.[^[:space:]@]+$'",
    ]) expect(definition).toContain(marker);
    expect(migration).toContain("Review-contact validation extension did not match command_create_draft_rental");
  });

  it("extends the deployed command definition without replacing certified create behavior", () => {
    expect(migration).toContain("pg_get_functiondef('erp.command_create_draft_rental(jsonb)'::regprocedure)");
    for (const marker of ["current_user_has_permission('rental.create')", "CREATE_DRAFT_RENTAL", "customer_snapshot,project_snapshot,date_out", "customer_row.id,project_row.id"]) expect(definition).toContain(marker);
    expect(migration).toContain("Unexpected command_create_draft_rental definition");
  });
});
