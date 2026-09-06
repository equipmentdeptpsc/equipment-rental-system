import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createSupabaseOperationalCommands } from "@/integrations/supabase/SupabaseOperationalCommandRepository";
import { createDisabledRemoteOperationalCommands } from "@/features/rental/operations/commands/UnavailableOperationalCommandRepository";
import { assertSafeSupabaseTestConfiguration, assertSupabaseFixtureMutationAllowed, readSupabasePhaseC2TestConfiguration } from "./support/supabasePhaseC2Harness";

const migrations = ["supabase/migrations/20260729000200_phase_c2_tenant_operational_commands.sql", "supabase/migrations/20260729000300_phase_c2_mutation_functions.sql", "supabase/migrations/20260729000400_phase_c2h_command_hardening.sql"]
  .map((file) => fs.readFileSync(path.resolve(file), "utf8")).join("\n");

describe("Phase C2 operational command architecture", () => {
  it("routes provider-neutral commands through isolated Supabase RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, disposition: "ACCEPTED", value: {}, serverOccurredAt: "2026-07-29T00:00:00Z", refresh: [] }, error: null });
    const repositories = createSupabaseOperationalCommands({ schema: (schema: string) => ({ rpc: (name: string, args: unknown) => rpc(schema, name, args) }) });
    await repositories.customerReviewCommands.createRequest({ commandId: "c", idempotencyKey: "i", deurId: "d", rentalLineId: "l", revisionId: "r" });
    await repositories.deurRevisionCommands.createCorrection({ commandId: "c2", idempotencyKey: "i2", deurId: "d", sourceRevisionId: "r", changes: {}, reasonCode: "OTHER" });
    await repositories.meterCheckpointCommands.record({ commandId: "c3", idempotencyKey: "i3", deurId: "d", rentalLineId: "l", equipmentId: "e", kind: "opening", reading: 1 });
    await repositories.rentalReturnCommands.returnLine({ commandId: "c4", idempotencyKey: "i4", rentalId: "r", rentalLineId: "l", equipmentId: "e", actualReturnDate: "2026-09-06" });
    await repositories.rentalClosureCommands.close({ commandId: "c5", idempotencyKey: "i5", rentalId: "r" });
    expect(rpc.mock.calls.map((call) => call[1])).toEqual(["command_create_customer_review_request", "command_create_deur_correction", "command_record_meter_checkpoint", "command_return_rental_line", "command_close_rental"]);
    expect(rpc.mock.calls.every((call) => call[0] === "erp")).toBe(true);
  });

  it("maps SDK transport failures at the adapter boundary", async () => {
    const repositories = createSupabaseOperationalCommands({ schema: () => ({ rpc: async () => ({ data: null, error: { message: "offline" } }) }) });
    await expect(repositories.rentalReturnCommands.returnAll({ commandId: "c", idempotencyKey: "i", rentalId: "r" })).resolves.toMatchObject({ success: false, code: "TRANSPORT_FAILURE", retryable: true });
  });

  it("rejects malformed server JSON instead of casting it into domain results", async () => {
    const repositories = createSupabaseOperationalCommands({ schema: () => ({ rpc: async () => ({ data: { surprise: true }, error: null }) }) });
    await expect(repositories.rentalClosureCommands.getReadiness({ rentalId: "r" }))
      .resolves.toMatchObject({ success: false, code: "VALIDATION_REJECTED", refreshRequired: true });
  });

  it("keeps Remote operational writes disabled unless explicitly enabled", async () => {
    const disabled = createDisabledRemoteOperationalCommands();
    await expect(disabled.rentalReturnCommands.returnAll({ commandId: "c", idempotencyKey: "i", rentalId: "r" }))
      .resolves.toMatchObject({ success: false, code: "NOT_ENABLED" });
  });

  it("adds tenant scope, secure hashes, RLS, direct-write revocation, and all command boundaries", () => {
    for (const token of ["CREATE TABLE companies", "company_id=current_company_id()", "pg_catalog.encode(extensions.digest(raw_token,'sha256'),'hex')", "command_create_deur_correction", "command_record_meter_checkpoint", "command_return_rental_line", "command_return_all_rental_lines", "get_rental_closure_readiness", "command_close_rental", "'CONFLICT'", "INSERT INTO audit_log"]) expect(migrations).toContain(token);
    expect(migrations).not.toMatch(/INSERT INTO audit_log[^;]+raw_token/is);
    expect(migrations).toContain("REVOKE INSERT,UPDATE,DELETE ON rentals,rental_equipment_lines,deurs");
  });

  it("keeps public review function-scoped and generically invalid", () => {
    expect(migrations).toContain("get_public_customer_review");
    expect(migrations).toContain("The review link is invalid or expired.");
    expect(migrations).toContain("REVOKE ALL ON customer_review_requests,deur_meter_checkpoints FROM anon,authenticated");
  });
});

describe("Phase C2 live integration safety guard", () => {
  it("skips by default and rejects suspicious targets", () => {
    expect(readSupabasePhaseC2TestConfiguration({}).enabled).toBe(false);
    expect(() => assertSafeSupabaseTestConfiguration({ enabled: true, url: "https://production.supabase.co", publishableKey: "p", serviceKey: "s", environmentId: "production", projectRef: "production" })).toThrow(/Refusing suspicious/);
    const safe={ enabled: true, url: "http://localhost:54321", publishableKey: "p", serviceKey: "s", environmentId: "phase-c2-test", projectRef: "phase-c2-test", allowMutation: true };
    expect(() => assertSafeSupabaseTestConfiguration(safe)).not.toThrow();
    expect(() => assertSupabaseFixtureMutationAllowed({ ...safe, allowMutation: false }, ["TENANT-UAT-001"])).toThrow(/mutation is disabled/);
    expect(() => assertSupabaseFixtureMutationAllowed(safe, ["TENANT-LOCAL-001"])).toThrow(/fixture-specific/);
    expect(() => assertSupabaseFixtureMutationAllowed(safe, ["TENANT-UAT-001"])).not.toThrow();
  });
});
