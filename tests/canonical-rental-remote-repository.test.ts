import { describe, expect, it, vi } from "vitest";
import { SupabaseCanonicalRentalRepository } from "@/integrations/supabase/SupabaseCanonicalRentalRepository";

function client(responses: unknown[]) {
  const rpc = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
  return { value: { schema: vi.fn(() => ({ rpc })) }, rpc };
}

describe("canonical remote Rental repository", () => {
  it("uses the protected workspace and reference RPCs and maps legitimate empty results", async () => {
    const remote = client([
      { data: { success: true, rentalId: "r-1", contracts: [], commercialSnapshots: [] }, error: null },
      { data: { success: true, dispositions: [] }, error: null },
      { data: { success: true, costCodes: [], activityCodes: [] }, error: null },
    ]);
    const repository = new SupabaseCanonicalRentalRepository(remote.value as never);
    expect(await repository.readWorkspace("r-1")).toEqual({ success: true, value: { rentalId: "r-1", contracts: [], commercialSnapshots: [], expectationDispositions: [] } });
    expect(await repository.readReferenceData()).toEqual({ success: true, value: { costCodes: [], activityCodes: [] } });
    expect(remote.rpc).toHaveBeenNthCalledWith(1, "read_canonical_rental_workspace", { target_rental_id: "r-1" });
    expect(remote.rpc).toHaveBeenNthCalledWith(2, "read_deur_expectation_dispositions", { target_rental_id: "r-1" });
    expect(remote.rpc).toHaveBeenNthCalledWith(3, "read_canonical_rental_reference_data", {});
  });

  it("uses command RPCs, preserves idempotency input, and accepts replayed outcomes", async () => {
    const response = { success: true, disposition: "REPLAYED", value: { rentalId: "r-1", rentalNumber: "RNT-2026-000001", status: "Draft", approvalStatus: "NotSubmitted", version: 1, lineIds: ["l-1"] } };
    const remote = client([{ data: response, error: null }]);
    const repository = new SupabaseCanonicalRentalRepository(remote.value as never);
    const input = { commandId: "r-1", idempotencyKey: "stable-key", customerId: "c-1", projectId: "p-1", dateOut: "2026-08-22", rentalType: "Operated Rental" as const, representativeName: "UAT D3E Review Representative", representativeEmail: "uat-d3e-review@example.test", lines: [{ assignmentId: "a-1" }] };
    expect(await repository.createDraft(input)).toEqual(response);
    expect(remote.rpc).toHaveBeenCalledWith("command_create_draft_rental", { command: input });
  });

  it("does not expose raw transport errors or fabricate local results", async () => {
    const remote = client([{ data: null, error: { message: "relation secret_table denied" } }]);
    const result = await new SupabaseCanonicalRentalRepository(remote.value as never).readReferenceData();
    expect(result).toEqual({ success: false, code: "TRANSPORT_FAILURE", message: "Confirmation was not received from the remote service. Refresh before retrying." });
    expect(JSON.stringify(result)).not.toContain("secret_table");
  });

  it("reads Release readiness through the protected canonical RPC without reconstructing it locally", async () => {
    const remote = client([{ data: { eligible: false, rentalId: "r-1", reasonCodes: ["RELEASE_NOT_READY", "SNAPSHOT_STALE"], incompleteEquipmentLines: [{ rentalEquipmentLineId: "line-1", missingFields: ["snapshotFreshness"], invalidValues: [] }] }, error: null }]);
    const result = await new SupabaseCanonicalRentalRepository(remote.value as never).getReleaseReadiness("r-1");
    expect(result).toEqual({ success: true, value: { eligible: false, rentalId: "r-1", reasonCodes: ["RELEASE_NOT_READY", "SNAPSHOT_STALE"], incompleteEquipmentLines: [{ rentalEquipmentLineId: "line-1", missingFields: ["snapshotFreshness"], invalidValues: [] }] } });
    expect(remote.rpc).toHaveBeenCalledTimes(1);
    expect(remote.rpc).toHaveBeenCalledWith("rental_release_readiness", { target_rental_id: "r-1" });
  });

  it("fails closed when canonical readiness rejects the actor or Rental", async () => {
    const remote = client([{ data: { eligible: false, reasonCodes: ["FORBIDDEN"], incompleteEquipmentLines: [] }, error: null }]);
    expect(await new SupabaseCanonicalRentalRepository(remote.value as never).getReleaseReadiness("wrong-rental")).toMatchObject({ success: false, code: "FORBIDDEN" });
  });

  it("surfaces only a whitelisted draft-validation reason while retaining the compatible code", async () => {
    const remote = client([{ data: { success: false, code: "VALIDATION_REJECTED", details: { reason: "INVALID_LINE_SHAPE", internal: "must-not-reach-ui" } }, error: null }]);
    const result = await new SupabaseCanonicalRentalRepository(remote.value as never).createDraft({ commandId: "r-1", idempotencyKey: "key", customerId: "c-1", projectId: "p-1", dateOut: "2026-08-22", rentalType: "Bare Rental", representativeName: "Representative", representativeEmail: "representative@example.test", lines: [{ assignmentId: "a-1" }] });
    expect(result).toEqual({ success: false, code: "VALIDATION_REJECTED", message: "The request is incomplete or invalid. (INVALID_LINE_SHAPE)", details: { reason: "INVALID_LINE_SHAPE" }, currentVersion: undefined });
  });

  it("does not expose unrecognized validation detail and preserves non-validation mappings", async () => {
    const remote = client([
      { data: { success: false, code: "VALIDATION_REJECTED", details: { reason: "SQL_INTERNAL", detail: "must-not-reach-ui" } }, error: null },
      { data: { success: false, code: "EQUIPMENT_INTERVAL_CONFLICT" }, error: null },
      { data: { success: false, code: "MISSING_RELATIONSHIP" }, error: null },
    ]);
    const repository = new SupabaseCanonicalRentalRepository(remote.value as never);
    const input = { commandId: "r-1", idempotencyKey: "key", customerId: "c-1", projectId: "p-1", dateOut: "2026-08-22", rentalType: "Bare Rental" as const, representativeName: "Representative", representativeEmail: "representative@example.test", lines: [{ assignmentId: "a-1" }] };
    expect(await repository.createDraft(input)).toMatchObject({ success: false, code: "VALIDATION_REJECTED", message: "The request is incomplete or invalid.", details: undefined });
    expect(await repository.createDraft(input)).toMatchObject({ success: false, code: "EQUIPMENT_INTERVAL_CONFLICT", message: "This equipment is already committed for the requested interval." });
    expect(await repository.createDraft(input)).toMatchObject({ success: false, code: "MISSING_RELATIONSHIP", message: "Referenced Rental information has changed or is unavailable. Refresh and try again." });
  });

});
