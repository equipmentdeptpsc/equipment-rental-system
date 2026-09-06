import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/toast/ToastContext";
import { useAuth } from "@/features/auth/AuthContext";
import { useRental } from "../context/RentalContext";
import type { RentalRecord } from "../types";
import { deriveRentalQuickActions, visibleRentalQuickActions, type RentalQuickActionId } from "../quick-actions/rentalQuickActions";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseCanonicalRemoteRentalMutations, canUseLegacyRentalMutations } from "../services/rentalRuntimeCapability";
import { requestCanonicalRentalRefresh } from "../remote/canonicalRentalRefresh";
import { getRentalApprovalStatus } from "../approval/rentalApproval";
import { evaluateCanonicalApprovalDecisionEligibility } from "../approval/canonicalApprovalDecisionEligibility";

export default function RentalQuickActions({ rental, hideClose = false }: { rental: RentalRecord; hideClose?: boolean }) {
  const { user, hasPermission } = useAuth();
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const legacyMutations = canUseLegacyRentalMutations(configuration);
  const canonicalMutations = canUseCanonicalRemoteRentalMutations(configuration) && Boolean(commandRepositories.canonicalRental);
  const mutationsAvailable = legacyMutations || canonicalMutations;
  const { transitionRental, returnRental, releaseRental, submitForApproval, approveRental, rejectRental, getReleaseReadiness } = useRental();
  const { showToast } = useToast(); const [pending, setPending] = useState<RentalQuickActionId>();
  const [remoteReturnReady, setRemoteReturnReady] = useState(false);
  const [remoteReturnMessage, setRemoteReturnMessage] = useState("Checking canonical Return readiness…");
  const [actualReturnDate, setActualReturnDate] = useState("");
  const submissionPending = useRef(false);
  const commandIdentity = useRef<Partial<Record<RentalQuickActionId, { commandId: string; idempotencyKey: string }>>>({});
  const permissions = { reserve: hasPermission("rental.update"), manage: hasPermission("rental.manage"), activate: hasPermission("rental.activate"), approve: hasPermission("rental.approval.decide"), submit: hasPermission("rental.approval.submit"), release: hasPermission("rental.release"), return: hasPermission("rental.return") };
  const approval = getRentalApprovalStatus(rental);
  const decisionEligibility = evaluateCanonicalApprovalDecisionEligibility(rental, user?.id, permissions.approve);
  useEffect(() => {
    let current = true;
    if (!canonicalMutations || rental.status !== "Active" || !permissions.return) { setRemoteReturnReady(false); return () => { current = false; }; }
    setRemoteReturnReady(false); setRemoteReturnMessage("Checking canonical Return readiness…");
    void commandRepositories.rentalReturnCommands.getReturnReadiness({ rentalId: rental.id }).then((result) => {
      if (!current) return;
      const ready = result.success && result.value.ready;
      setRemoteReturnReady(ready);
      setRemoteReturnMessage(ready ? "Canonical Return readiness passed." : result.success ? result.value.blockers[0]?.message ?? "Return prerequisites are incomplete." : result.message);
    });
    return () => { current = false; };
  }, [canonicalMutations, commandRepositories.rentalReturnCommands, permissions.return, rental.id, rental.status, rental.rowVersion]);
  const model = canonicalMutations
    ? rental.status === "Draft"
      ? approval === "Pending" ? { actions: decisionEligibility.eligible ? [{ id: "approve" as const, label: "Approve Rental" }, { id: "reject" as const, label: "Reject Rental" }] : [], message: decisionEligibility.message ?? "Awaiting Manager Approval" }
        : approval === "Approved" ? { actions: permissions.reserve ? [{ id: "reserve" as const, label: "Reserve Rental" }] : [], message: "Approved" }
          : { actions: permissions.submit ? [{ id: "submit" as const, label: approval === "Rejected" ? "Resubmit for Approval" : "Submit for Approval" }] : [], message: approval === "Rejected" ? rental.approvalDecisionRemarks ? `Rejected: ${rental.approvalDecisionRemarks}` : "Rejected" : undefined }
      : rental.status === "Reserved" ? { actions: permissions.release ? [{ id: "release" as const, label: "Release Equipment" }] : [], message: "Approved and reserved" }
        : rental.status === "Released" ? { actions: permissions.activate ? [{ id: "activate" as const, label: "Activate Rental" }] : [], message: "Released" }
        : rental.status === "Active" ? { actions: permissions.return ? [{ id: "return" as const, label: "Return Equipment" }] : [], message: "Active" }
        : { actions: [], message: undefined }
    : deriveRentalQuickActions(rental, permissions);
  async function run(id: RentalQuickActionId) {
    if (submissionPending.current) return;
    if (canonicalMutations) {
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
        if (id === "submit") result = await repository.submitApproval(input);
        else if (id === "approve") result = await repository.decideApproval({ ...input, decision: "Approved" });
        else if (id === "reject") result = await repository.decideApproval({ ...input, decision: "Rejected", remarks: rejectionRemarks });
        else if (id === "reserve") result = await repository.reserve(input);
        else if (id === "release") result = await repository.release(input);
        else if (id === "activate") result = await repository.activate(input);
        else if (id === "return") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(actualReturnDate)) { showToast("Enter the authoritative Return business date.", "error"); return; }
          result = await commandRepositories.rentalReturnCommands.returnAll({ ...identity, rentalId: rental.id, actualReturnDate, expectedVersion });
        }
        else { showToast("This Rental action is not yet certified for remote use.", "error"); return; }
        if (result.success) { delete commandIdentity.current[id]; requestCanonicalRentalRefresh(); }
        showToast(result.success ? `${model.actions.find((item) => item.id === id)?.label ?? "Rental action"} completed.` : result.message, result.success ? "success" : "error");
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
    showToast(result.success ? `${model.actions.find((item) => item.id === id)?.label ?? "Rental action"} completed.` : result.message ?? "Rental action failed.", result.success ? "success" : "error"); submissionPending.current = false; setPending(undefined);
  }
  const canEditTerms = hasPermission("rental.commercialTerms.manage") && (legacyMutations ? ["Draft", "Assigned", "Reserved"].includes(rental.status) : rental.status === "Draft");
  const actions = visibleRentalQuickActions(model, hideClose).filter((action) => legacyMutations || ["submit", "approve", "reject", "reserve", "release", "activate", "return"].includes(action.id));
  const releaseReady = canonicalMutations ? true : rental.status === "Reserved" ? getReleaseReadiness(rental.id).eligible : true;
  if (!mutationsAvailable) return null;
  return <div className="flex flex-wrap items-center gap-2">{model.message && <span className="text-sm text-slate-600">{model.message}</span>}{canonicalMutations && rental.status === "Active" && permissions.return && <label className="text-sm text-slate-600">Return business date<input aria-label="Return business date" className="app-control ml-2" type="date" value={actualReturnDate} onChange={(event) => setActualReturnDate(event.target.value)} /></label>}{canEditTerms && <Link className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700" to={`/rentals/${rental.id}/commercial-terms`}>Edit Commercial Terms</Link>}{actions.map((action) => <Button key={action.id} variant="secondary" disabled={Boolean(pending) || (action.id === "release" && !releaseReady) || (canonicalMutations && action.id === "return" && (!remoteReturnReady || !/^\d{4}-\d{2}-\d{2}$/.test(actualReturnDate)))} title={action.id === "release" && !releaseReady ? "Complete every DEUR release-readiness requirement first." : canonicalMutations && action.id === "return" && !remoteReturnReady ? remoteReturnMessage : canonicalMutations && action.id === "return" ? "Enter the authoritative Return business date." : undefined} onClick={() => run(action.id)}>{pending === action.id ? "Working…" : action.label}</Button>)}</div>;
}
