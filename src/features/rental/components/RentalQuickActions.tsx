import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/toast/ToastContext";
import { useAuth } from "@/features/auth/AuthContext";
import { useRental } from "../context/RentalContext";
import type { RentalRecord } from "../types";
import { deriveRentalQuickActions, visibleRentalQuickActions, type RentalQuickActionId } from "../quick-actions/rentalQuickActions";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseCanonicalRemoteRentalActivateMutation, canUseCanonicalRemoteRentalApprovalMutations, canUseCanonicalRemoteRentalCancelMutation, canUseCanonicalRemoteRentalMutations, canUseCanonicalRemoteRentalReleaseMutation, canUseCanonicalRemoteRentalReserveMutation, canUseCanonicalRemoteRentalReturnMutation, canUseLegacyRentalMutations } from "../services/rentalRuntimeCapability";
import { requestCanonicalRentalRefresh } from "../remote/canonicalRentalRefresh";
import { getRentalApprovalStatus } from "../approval/rentalApproval";
import { evaluateCanonicalApprovalDecisionEligibility } from "../approval/canonicalApprovalDecisionEligibility";

export default function RentalQuickActions({ rental, hideClose = false }: { rental: RentalRecord; hideClose?: boolean }) {
  const { user, hasPermission } = useAuth();
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const legacyMutations = canUseLegacyRentalMutations(configuration);
  const canonicalOperationalMutations = canUseCanonicalRemoteRentalMutations(configuration) && Boolean(commandRepositories.canonicalRental);
  const canonicalApprovalMutations = canUseCanonicalRemoteRentalApprovalMutations(configuration) && Boolean(commandRepositories.canonicalRental);
  const canonicalReserveMutations = canUseCanonicalRemoteRentalReserveMutation(configuration) && Boolean(commandRepositories.canonicalRental);
  const canonicalReleaseMutations = canUseCanonicalRemoteRentalReleaseMutation(configuration) && Boolean(commandRepositories.canonicalRental);
  const canonicalActivateMutations = canUseCanonicalRemoteRentalActivateMutation(configuration) && Boolean(commandRepositories.canonicalRental);
  const canonicalReturnMutations = canUseCanonicalRemoteRentalReturnMutation(configuration) && Boolean(commandRepositories.rentalReturnCommands);
  const canonicalCancelMutations = canUseCanonicalRemoteRentalCancelMutation(configuration) && Boolean(commandRepositories.rentalLifecycleCommands);
  const mutationsAvailable = legacyMutations || canonicalOperationalMutations || canonicalApprovalMutations || canonicalReserveMutations || canonicalReleaseMutations || canonicalActivateMutations || canonicalReturnMutations || canonicalCancelMutations;
  const { transitionRental, returnRental, releaseRental, submitForApproval, approveRental, rejectRental, getReleaseReadiness } = useRental();
  const { showToast } = useToast(); const [pending, setPending] = useState<RentalQuickActionId>();
  const [remoteReturnReady, setRemoteReturnReady] = useState(false);
  const [remoteReturnMessage, setRemoteReturnMessage] = useState("Checking canonical Return readiness…");
  const [remoteReleaseReadiness, setRemoteReleaseReadiness] = useState<{ status: "inactive" | "loading" | "ready" | "error"; eligible: boolean; message: string }>({ status: "inactive", eligible: false, message: "Release readiness could not be verified." });
  const [actualReturnDate, setActualReturnDate] = useState("");
  const submissionPending = useRef(false);
  const commandIdentity = useRef<Partial<Record<RentalQuickActionId, { commandId: string; idempotencyKey: string }>>>({});
  const permissions = { reserve: hasPermission("rental.update"), manage: hasPermission("rental.manage"), cancel: hasPermission("rental.manage"), activate: hasPermission("rental.activate"), approve: hasPermission("rental.approval.decide"), submit: hasPermission("rental.approval.submit"), release: hasPermission("rental.release"), return: hasPermission("rental.return") };
  const approval = getRentalApprovalStatus(rental);
  const decisionEligibility = evaluateCanonicalApprovalDecisionEligibility(rental, user?.id, permissions.approve);
  useEffect(() => {
    let current = true;
    if (!canonicalReturnMutations || rental.status !== "Active" || !permissions.return) { setRemoteReturnReady(false); return () => { current = false; }; }
    setRemoteReturnReady(false); setRemoteReturnMessage("Checking canonical Return readiness…");
    void commandRepositories.rentalReturnCommands.getReturnReadiness({ rentalId: rental.id }).then((result) => {
      if (!current) return;
      const ready = result.success && result.value.ready;
      setRemoteReturnReady(ready);
      setRemoteReturnMessage(ready ? "Canonical Return readiness passed." : result.success ? result.value.blockers[0]?.message ?? "Return prerequisites are incomplete." : result.message);
    });
    return () => { current = false; };
  }, [canonicalReturnMutations, commandRepositories.rentalReturnCommands, permissions.return, rental.id, rental.status, rental.rowVersion]);
  useEffect(() => {
    let current = true;
    if (!canonicalReleaseMutations || rental.status !== "Reserved" || !permissions.release) {
      setRemoteReleaseReadiness({ status: "inactive", eligible: false, message: "Release readiness could not be verified." });
      return () => { current = false; };
    }
    setRemoteReleaseReadiness({ status: "loading", eligible: false, message: "Checking canonical Release readiness…" });
    void commandRepositories.canonicalRental!.getReleaseReadiness(rental.id).then((result) => {
      if (!current) return;
      if (!result.success) { setRemoteReleaseReadiness({ status: "error", eligible: false, message: "Release readiness could not be verified." }); return; }
      const reason = result.value.reasonCodes[0] ?? result.value.incompleteEquipmentLines.flatMap(line => line.missingFields)[0];
      setRemoteReleaseReadiness({ status: "ready", eligible: result.value.eligible, message: result.value.eligible ? "Canonical Release readiness passed." : reason ? `Canonical Release readiness is incomplete: ${reason}.` : "Canonical Release readiness is incomplete." });
    }).catch(() => { if (current) setRemoteReleaseReadiness({ status: "error", eligible: false, message: "Release readiness could not be verified." }); });
    return () => { current = false; };
  }, [canonicalReleaseMutations, commandRepositories.canonicalRental, permissions.release, rental.id, rental.status, rental.rowVersion]);
  const model = canonicalOperationalMutations || canonicalApprovalMutations || canonicalReserveMutations || canonicalReleaseMutations || canonicalActivateMutations || canonicalReturnMutations || canonicalCancelMutations
    ? rental.status === "Draft"
      ? approval === "Pending" ? { actions: canonicalApprovalMutations && decisionEligibility.eligible ? [{ id: "approve" as const, label: "Approve Rental" }, { id: "reject" as const, label: "Reject Rental" }] : [], message: decisionEligibility.message ?? "Awaiting Manager Approval" }
        : approval === "Approved" ? { actions: (canonicalOperationalMutations || canonicalReserveMutations) && permissions.reserve ? [{ id: "reserve" as const, label: "Reserve Rental" }] : [], message: "Approved" }
          : { actions: canonicalApprovalMutations && permissions.submit ? [{ id: "submit" as const, label: approval === "Rejected" ? "Resubmit for Approval" : "Submit for Approval" }] : [], message: approval === "Rejected" ? rental.approvalDecisionRemarks ? `Rejected: ${rental.approvalDecisionRemarks}` : "Rejected" : undefined }
      : rental.status === "Reserved" ? { actions: (canonicalOperationalMutations || canonicalReleaseMutations) && permissions.release ? [{ id: "release" as const, label: "Release Equipment" }] : [], message: "Approved and reserved" }
        : rental.status === "Released" ? { actions: canonicalActivateMutations && permissions.activate ? [{ id: "activate" as const, label: "Activate Rental" }] : [], message: "Released" }
        : rental.status === "Active" ? { actions: canonicalReturnMutations && permissions.return ? [{ id: "return" as const, label: "Return Equipment" }] : [], message: "Active" }
        : { actions: [], message: undefined }
    : deriveRentalQuickActions(rental, permissions);
  async function run(id: RentalQuickActionId) {
    if (submissionPending.current) return;
    if (canonicalOperationalMutations || canonicalApprovalMutations || canonicalReserveMutations || canonicalReleaseMutations || canonicalActivateMutations || canonicalReturnMutations || canonicalCancelMutations) {
      const expectedVersion = rental.rowVersion;
      if (typeof expectedVersion !== "number") { showToast("Canonical Rental version is unavailable. Refresh and try again.", "error"); return; }
      const rejectionRemarks = id === "reject" ? window.prompt("Rejection reason") ?? "" : undefined;
      if (id === "reject" && !rejectionRemarks?.trim()) { showToast("A rejection reason is required.", "error"); return; }
      const identity = commandIdentity.current[id] ??= { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
      const input = { ...identity, rentalId: rental.id, expectedVersion };
      const repository = commandRepositories.canonicalRental!;
      submissionPending.current = true;
      setPending(id);
      try {
        let result;
        if (id === "submit" && canonicalApprovalMutations) result = await repository.submitApproval(input);
        else if (id === "approve" && canonicalApprovalMutations) result = await repository.decideApproval({ ...input, decision: "Approved" });
        else if (id === "reject" && canonicalApprovalMutations) result = await repository.decideApproval({ ...input, decision: "Rejected", remarks: rejectionRemarks });
        else if (id === "reserve" && (canonicalOperationalMutations || canonicalReserveMutations)) result = await repository.reserve(input);
        else if (id === "release" && (canonicalOperationalMutations || canonicalReleaseMutations)) result = await repository.release(input);
        else if (id === "activate" && (canonicalOperationalMutations || canonicalActivateMutations)) result = await repository.activate(input);
        else if (id === "return" && (canonicalOperationalMutations || canonicalReturnMutations)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(actualReturnDate)) { showToast("Enter the authoritative Return business date.", "error"); return; }
          result = await commandRepositories.rentalReturnCommands.returnAll({ ...identity, rentalId: rental.id, actualReturnDate, expectedVersion });
        }
        else if (id === "cancel" && canonicalCancelMutations) result = await commandRepositories.rentalLifecycleCommands.cancel(input);
        else { showToast("This Rental action is not yet certified for remote use.", "error"); return; }
        if (result.success) { delete commandIdentity.current[id]; requestCanonicalRentalRefresh(); }
        showToast(result.success ? `${modelWithCancellation.actions.find((item) => item.id === id)?.label ?? "Rental action"} completed.` : result.message, result.success ? "success" : "error");
      } catch {
        showToast("Confirmation was not received from the remote service. Refresh before retrying.", "error");
      } finally {
        submissionPending.current = false;
        setPending(undefined);
      }
      return;
    }
    submissionPending.current = true;
    setPending(id);
    let result;
    if (id === "reserve") {
      const assigned = rental.status === "Draft" ? transitionRental(rental.id, "Assigned") : { success: true };
      result = assigned.success ? transitionRental(rental.id, "Reserved") : assigned;
    }
    else if (id === "submit") result = submitForApproval(rental.id);
    else if (id === "approve") result = approveRental(rental.id, window.prompt("Approval remarks (optional)") ?? "");
    else if (id === "reject") result = rejectRental(rental.id, window.prompt("Rejection reason") ?? "");
    else if (id === "release") result = releaseRental(rental.id, user?.name ?? "");
    else if (id === "activate") result = transitionRental(rental.id, "Active");
    else if (id === "return") result = returnRental(rental.id);
    else result = transitionRental(rental.id, "Closed");
    showToast(result.success ? `${modelWithCancellation.actions.find((item) => item.id === id)?.label ?? "Rental action"} completed.` : result.message ?? "Rental action failed.", result.success ? "success" : "error"); submissionPending.current = false; setPending(undefined);
  }
  const canEditTerms = hasPermission("rental.commercialTerms.update") && (legacyMutations ? ["Draft", "Assigned", "Reserved"].includes(rental.status) : canonicalOperationalMutations && rental.status === "Draft");
  const modelWithCancellation = canonicalCancelMutations && permissions.cancel && ["Draft", "Assigned", "Reserved"].includes(rental.status) ? { ...model, actions: [...model.actions, { id: "cancel" as const, label: "Cancel Rental" }] } : model;
  const actions = visibleRentalQuickActions(modelWithCancellation, hideClose).filter((action) => legacyMutations || canonicalOperationalMutations || (canonicalReserveMutations && action.id === "reserve") || (canonicalReleaseMutations && action.id === "release") || (canonicalActivateMutations && action.id === "activate") || (canonicalReturnMutations && action.id === "return") || (canonicalCancelMutations && action.id === "cancel") || (canonicalApprovalMutations && ["submit", "approve", "reject"].includes(action.id)));
  const releaseReady = canonicalReleaseMutations ? remoteReleaseReadiness.status === "ready" && remoteReleaseReadiness.eligible : rental.status === "Reserved" ? getReleaseReadiness(rental.id).eligible : true;
  if (!mutationsAvailable) return null;
  return <div className="flex flex-wrap items-center gap-2">{modelWithCancellation.message && <span className="text-sm text-slate-600">{modelWithCancellation.message}</span>}{(canonicalOperationalMutations || canonicalReturnMutations) && rental.status === "Active" && permissions.return && <label className="text-sm text-slate-600">Return business date<input aria-label="Return business date" className="app-control ml-2" type="date" value={actualReturnDate} onChange={(event) => setActualReturnDate(event.target.value)} /></label>}{canEditTerms && <Link className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700" to={`/rentals/${rental.id}/commercial-terms`}>Edit Commercial Terms</Link>}{actions.map((action) => <Button key={action.id} variant="secondary" disabled={Boolean(pending) || (action.id === "release" && !releaseReady) || ((canonicalOperationalMutations || canonicalReturnMutations) && action.id === "return" && (!remoteReturnReady || !/^\d{4}-\d{2}-\d{2}$/.test(actualReturnDate)))} title={action.id === "release" && !releaseReady ? canonicalReleaseMutations ? remoteReleaseReadiness.message : "Complete every DEUR release-readiness requirement first." : (canonicalOperationalMutations || canonicalReturnMutations) && action.id === "return" && !remoteReturnReady ? remoteReturnMessage : (canonicalOperationalMutations || canonicalReturnMutations) && action.id === "return" ? "Enter the authoritative Return business date." : undefined} onClick={() => run(action.id)}>{pending === action.id ? "Working…" : action.label}</Button>)}</div>;
}
