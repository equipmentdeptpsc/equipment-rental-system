import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalCommandResult, CanonicalCommandValue, CanonicalReadResult, CanonicalRentalReferenceData, CanonicalRentalReleaseReadiness, CanonicalRentalRemoteRepository, CanonicalRentalReturnEvidence, CanonicalRentalWorkspace, CanonicalVersionedInput, ConfigureCanonicalCustomerReviewInput, CreateCanonicalDraftInput, DecideCanonicalApprovalInput, UpdateCanonicalTermsInput } from "@/features/rental/remote/contracts";

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Your session has expired. Sign in and try again.", FORBIDDEN: "You do not have permission to perform this action.",
  VALIDATION_REJECTED: "The request is incomplete or invalid.", NOT_FOUND: "Referenced Rental information has changed or is unavailable. Refresh and try again.",
  MISSING_RELATIONSHIP: "Referenced Rental information has changed or is unavailable. Refresh and try again.", EQUIPMENT_UNAVAILABLE: "This equipment already has an active or pending Rental.",
  RENTAL_NUMBER_CONFLICT: "Rental number allocation conflicted. Please retry.", RENTAL_CONFLICT: "This Rental already exists.", CONFLICT: "This Rental changed while you were working. Refresh and try again.",
  LINE_SET_MISMATCH: "The Rental equipment list changed. Refresh and try again.", INVALID_TRANSITION: "This action is not available for the Rental's current state.",
  RELEASE_NOT_READY: "This Rental is not ready for release.", IDEMPOTENCY_MISMATCH: "This request conflicts with an earlier submission. Refresh before retrying.",
  EXPECTATION_NOT_WAIVABLE: "The selected historical expectation is not eligible for waiver.", EXPECTATION_HAS_DEUR: "A DEUR already exists for this expectation.", ALREADY_WAIVED: "This expectation is already waived.",
  PERSISTENCE_FAILURE: "The remote service could not save the Rental. Refresh before retrying.", TRANSPORT_FAILURE: "Confirmation was not received from the remote service. Refresh before retrying.", INVALID_RESPONSE: "The remote service returned an invalid response.",
};
type RpcClient = Pick<SupabaseClient, "schema">;
export class SupabaseCanonicalRentalRepository implements CanonicalRentalRemoteRepository {
  constructor(private readonly client: RpcClient) {}
  async readWorkspace(rentalId: string) {
    const workspace=await this.read<CanonicalRentalWorkspace>("read_canonical_rental_workspace", { target_rental_id: rentalId }, value => ({ rentalId: String(value.rentalId), contracts: array(value.contracts), commercialSnapshots: array(value.commercialSnapshots), expectationDispositions:[] }));
    if(!workspace.success)return workspace;
    const dispositions=await this.read<{expectationDispositions:CanonicalRentalWorkspace["expectationDispositions"]}>("read_deur_expectation_dispositions",{target_rental_id:rentalId},value=>({expectationDispositions:array(value.dispositions)}));
    return dispositions.success?{success:true as const,value:{...workspace.value,...dispositions.value}}:dispositions;
  }
  async readReferenceData() { return this.read<CanonicalRentalReferenceData>("read_canonical_rental_reference_data", {}, value => ({ costCodes: array(value.costCodes), activityCodes: array(value.activityCodes) })); }
  async readReturnEvidence(rentalId: string, rentalEquipmentLineId: string) { return this.read<CanonicalRentalReturnEvidence>("read_rental_return_evidence", { target_rental_id:rentalId, target_rental_equipment_line_id:rentalEquipmentLineId }, value => value as unknown as CanonicalRentalReturnEvidence); }
  async getReleaseReadiness(rentalId: string): Promise<CanonicalReadResult<CanonicalRentalReleaseReadiness>> {
    try {
      const { data, error } = await this.client.schema("erp").rpc("rental_release_readiness", { target_rental_id: rentalId });
      if (error) return failure("TRANSPORT_FAILURE");
      const value = object(data);
      if (!value || typeof value.eligible !== "boolean") return failure("INVALID_RESPONSE");
      const reasonCodes = strings(value.reasonCodes);
      const failureCode = reasonCodes.find(item => item === "UNAUTHENTICATED" || item === "FORBIDDEN" || item === "NOT_FOUND");
      if (failureCode) return failure(failureCode);
      if (typeof value.rentalId !== "string" || !value.rentalId) return failure("INVALID_RESPONSE");
      return {
        success: true,
        value: {
          rentalId: value.rentalId,
          eligible: value.eligible,
          reasonCodes,
          incompleteEquipmentLines: array<Record<string, unknown>>(value.incompleteEquipmentLines).map(line => ({
            rentalEquipmentLineId: typeof line.rentalEquipmentLineId === "string" ? line.rentalEquipmentLineId : "",
            ...(typeof line.equipmentId === "string" ? { equipmentId: line.equipmentId } : {}),
            missingFields: strings(line.missingFields), invalidValues: strings(line.invalidValues),
            ...(typeof line.reasonCode === "string" ? { reasonCode: line.reasonCode } : {}),
          })),
        },
      };
    } catch { return failure("TRANSPORT_FAILURE"); }
  }
  createDraft(input: CreateCanonicalDraftInput) { return this.command("command_create_draft_rental", input); }
  updateTerms(input: UpdateCanonicalTermsInput) { return this.command("command_update_draft_rental_terms", input); }
  submitApproval(input: CanonicalVersionedInput) { return this.command("command_submit_rental_approval", input); }
  decideApproval(input: DecideCanonicalApprovalInput) { return this.command("command_decide_rental_approval", input); }
  reserve(input: CanonicalVersionedInput) { return this.command("command_reserve_rental", input); }
  release(input: CanonicalVersionedInput) { return this.command("command_release_rental", input); }
  activate(input: CanonicalVersionedInput) { return this.command("command_activate_rental", input); }
  configureCustomerReview(input: ConfigureCanonicalCustomerReviewInput) { return this.command("command_configure_rental_customer_review", input); }
  waiveDeurExpectation(input: import("@/features/rental/remote/contracts").WaiveDeurExpectationInput) { return this.command("command_waive_deur_expectation", input); }
  private async read<T>(name: string, args: Record<string, unknown>, map: (value: Record<string, unknown>) => T): Promise<CanonicalReadResult<T>> {
    try { const { data, error } = await this.client.schema("erp").rpc(name, args); if (error) return failure("TRANSPORT_FAILURE"); const value = object(data); if (!value || value.success !== true) return failure(code(value?.code)); return { success: true, value: map(value) }; } catch { return failure("TRANSPORT_FAILURE"); }
  }
  private async command(name: string, input: unknown): Promise<CanonicalCommandResult> {
    try { const { data, error } = await this.client.schema("erp").rpc(name, { command: input }); if (error) return failure("TRANSPORT_FAILURE"); const value = object(data); if (!value || value.success !== true) return failure(code(value?.code), value); const result = object(value.value); if (!result || typeof result.rentalId !== "string" || (typeof result.version !== "number" && typeof result.waiverId !== "string")) return failure("INVALID_RESPONSE"); return { success: true, disposition: value.disposition === "REPLAYED" ? "REPLAYED" : "ACCEPTED", value: result as unknown as CanonicalCommandValue }; } catch { return failure("TRANSPORT_FAILURE"); }
  }
}
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function array<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function strings(value: unknown): string[] { return array<unknown>(value).filter((item): item is string => typeof item === "string"); }
function code(value: unknown): keyof typeof messages { return typeof value === "string" && value in messages ? value : "INVALID_RESPONSE"; }
function failure(value: keyof typeof messages, source?: Record<string, unknown>): Extract<CanonicalCommandResult, { success: false }> { return { success: false, code: value as never, message: messages[value], details: source?.details, currentVersion: typeof source?.currentVersion === "number" ? source.currentVersion : undefined }; }
