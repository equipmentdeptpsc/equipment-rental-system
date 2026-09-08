import {
  useRentalWorkspaceAggregate,
} from "..";
import { aggregateRentalEquipmentLineDeurCompliance, evaluateRentalDeurCompliance, evaluateRentalEquipmentLineDeurCompliance, type RentalDeurComplianceResult } from "@/features/rental/deur/compliance/evaluateRentalDeurCompliance";
import RentalDeurComplianceIndicator from "@/features/rental/deur/compliance/RentalDeurComplianceIndicator";
import RentalDeurComplianceSummary from "@/features/rental/deur/compliance/RentalDeurComplianceSummary";
import { deurShiftWindowRepository } from "@/features/rental/deur/shift-window/repository";
import RentalDeurExpectationPolicyCard from "@/features/rental/deur/compliance/RentalDeurExpectationPolicyCard";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";
import DeurReleaseReadinessPanel from "@/features/rental/components/DeurReleaseReadinessPanel";
import ApprovalInvalidationNotice from "@/features/rental/approval/ApprovalInvalidationNotice";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { resolveRentalLinePresentation } from "@/features/rental/deur/presentation/resolveDeurPresentation";
import { useAuth } from "@/features/auth/AuthContext";
import { Link } from "react-router-dom";
import { resolveRentalWorkflowStatus } from "@/features/rental/workflow/resolveRentalWorkflowStatus";
import type { WorkspaceTab } from "../types";
import { detectClosedRentalIntegrityViolation } from "@/features/rental/services/detectClosedRentalIntegrityViolation";
import RentalWorkspaceSummaryStrip from "./RentalWorkspaceSummaryStrip";
import RentalWorkspaceWorkflowPanel from "./RentalWorkspaceWorkflowPanel";
import StatusBadge from "@/components/ui/StatusBadge";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseAnyRentalMutations, canUseLegacyRentalMutations, REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE } from "@/features/rental/services/rentalRuntimeCapability";
import { resolveRentalWorkspaceDeurPolicy } from "@/features/rental/services/resolveRentalWorkspaceDeurPolicy";
import { useState } from "react";
import { requestCanonicalRentalRefresh } from "@/features/rental/remote/canonicalRentalRefresh";
import RentalReturnEvidence from "./RentalReturnEvidence";

export default function RentalWorkspaceHeader({ activeTab }: { activeTab: WorkspaceTab }) {
  const dependencies = useApplicationDependenciesCompatibility();
  const { configuration } = dependencies;
  const legacyMutationsAvailable = canUseLegacyRentalMutations(configuration);
  const mutationsAvailable = canUseAnyRentalMutations(configuration, Boolean(dependencies.commandRepositories.canonicalRental));
  const aggregate =
    useRentalWorkspaceAggregate();
  const {equipment}=useEquipment();
  const {hasPermission}=useAuth();
  const [waiverMessage,setWaiverMessage]=useState("");
  const [waiverTarget,setWaiverTarget]=useState<RentalDeurComplianceResult["expectations"][number]>();
  const [waiverReason,setWaiverReason]=useState("");
  const compliance = evaluateRentalDeurCompliance({ rental: aggregate.rental, assignment: aggregate.assignment, deurs: aggregate.deurs, dispositions:aggregate.expectationDispositions??[], evaluationTimestamp: new Date().toISOString(), liveShiftWindows: deurShiftWindowRepository.getAll() });
  const lineCompliance = evaluateRentalEquipmentLineDeurCompliance({ rental: aggregate.rental, lines: aggregate.rentalEquipmentLines, deurs: aggregate.deurs, dispositions:aggregate.expectationDispositions??[], evaluationTimestamp: new Date().toISOString(), liveShiftWindows: deurShiftWindowRepository.getAll() });
  const displayedCompliance = aggregate.rentalEquipmentLines.length > 0 ? aggregateRentalEquipmentLineDeurCompliance(aggregate.rental.id, lineCompliance) : compliance;
  const effectiveDeurs = aggregate.rentalEquipmentLines.map((line) => [...aggregate.deurs]
    .filter((record) => (record.rentalEquipmentLineId ? record.rentalEquipmentLineId === line.id : record.equipmentId === line.equipmentId) && !record.revision?.supersededByRevisionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]).filter((record): record is NonNullable<typeof record> => Boolean(record));
  const commercialTermsAvailable = aggregate.rentalEquipmentLines.length > 0 && aggregate.rentalEquipmentLines.every((line) => Boolean(line.commercialSnapshot));
  const billableEvidence = effectiveDeurs.length === aggregate.rentalEquipmentLines.length && effectiveDeurs.every((record) => Boolean(record.totals?.operationMinutes || record.totalOperatingMinutes));
  const workflow=resolveRentalWorkflowStatus({rental:aggregate.rental,effectiveDeurs,commercialTermsAvailable,billableEvidence});
  const displayedPolicy = resolveRentalWorkspaceDeurPolicy(aggregate.rental, aggregate.rentalEquipmentLines);
  const historicalIntegrityViolations = detectClosedRentalIntegrityViolation(aggregate, displayedCompliance.status);

  return (
    <div className="app-card space-y-5 p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rental Workspace</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{aggregate.rental.customer}</h2>
          <p className="mt-1 text-sm text-slate-500">{aggregate.rental.project}</p>
          <p className="mt-1 text-xs text-slate-500">{aggregate.rental.rentalNumber ?? aggregate.rental.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={aggregate.rental.status === "Closed" ? "neutral" : "info"}>{aggregate.rental.status}</StatusBadge>
          <RentalDeurComplianceIndicator result={displayedCompliance} />
        </div>
      </div>

      <RentalWorkspaceSummaryStrip />
      <RentalWorkspaceWorkflowPanel />
      <RentalReturnEvidence />

      <RentalDeurComplianceSummary result={displayedCompliance} policy={displayedPolicy.policy} policyStaged={displayedPolicy.staged} onWaive={hasPermission("deur.expectation.waive")&&dependencies.commandRepositories.canonicalRental?.waiveDeurExpectation ? expectation=>{setWaiverTarget(expectation);setWaiverReason("");setWaiverMessage("");}:undefined} />
      {waiverTarget&&<section className="rounded border border-amber-300 bg-amber-50 p-4" aria-label="Historical DEUR expectation waiver"><h3 className="font-semibold">Waive {waiverTarget.workDate} DEUR expectation</h3><p className="mt-1 text-sm">This records an auditable exception. It does not create or modify a DEUR.</p><label className="mt-3 block text-sm font-medium">Audit reason<textarea className="mt-1 block w-full rounded border p-2" value={waiverReason} onChange={event=>setWaiverReason(event.target.value)} /></label><div className="mt-3 flex gap-2"><button type="button" className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!waiverReason.trim()} onClick={async()=>{const commandId=crypto.randomUUID(),result=await dependencies.commandRepositories.canonicalRental!.waiveDeurExpectation!({commandId,idempotencyKey:crypto.randomUUID(),rentalId:aggregate.rental.id,rentalEquipmentLineId:waiverTarget.rentalEquipmentLineId!,workDate:waiverTarget.workDate,expectationFingerprint:waiverTarget.expectationFingerprint!,reason:waiverReason.trim()});setWaiverMessage(result.success?"Historical DEUR expectation waived with canonical audit evidence.":result.message);if(result.success){setWaiverTarget(undefined);setWaiverReason("");requestCanonicalRentalRefresh();}}}>Confirm waiver</button><button type="button" className="rounded border px-3 py-2 text-sm" onClick={()=>{setWaiverTarget(undefined);setWaiverReason("");}}>Cancel</button></div></section>}
      {waiverMessage&&<p className="text-sm text-slate-700" role="status">{waiverMessage}</p>}
      {historicalIntegrityViolations.length > 0 && <div className="mt-4 rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950"><b>Historical integrity violation</b><p>This Closed rental predates the current closure gate: {historicalIntegrityViolations.join(", ")}. It remains readable and was not automatically changed.</p></div>}
      {aggregate.rentalEquipmentLines.length > 1 && <div className="mt-4 space-y-2"><h3 className="text-sm font-semibold">Equipment Line DEUR Compliance</h3>{lineCompliance.map((item) => {const line=aggregate.rentalEquipmentLines.find(candidate=>candidate.id===item.rentalEquipmentLineId);const label=line?resolveRentalLinePresentation(line,aggregate.rentalEquipmentLines,equipment).label:"Equipment record unavailable";return <p key={item.rentalEquipmentLineId} className={`rounded border p-2 text-sm ${item.result.status === "COMPLIANT" ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>{label}: {item.result.reason}</p>})}</div>}
      {legacyMutationsAvailable&&aggregate.rental.status!=="Closed"&&<RentalDeurExpectationPolicyCard rental={aggregate.rental} />}
      {!mutationsAvailable && aggregate.rental.status !== "Closed" && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE}</p>}
      {legacyMutationsAvailable&&["Draft","Assigned","Reserved"].includes(aggregate.rental.status)&&<DeurReleaseReadinessPanel rentalId={aggregate.rental.id} />}
      {aggregate.rental.status!=="Closed"&&<div className="mt-4 border-t pt-4"><RentalQuickActions rental={aggregate.rental} hideClose={activeTab==="closing"} /></div>}
      {mutationsAvailable&&aggregate.rental.status!=="Closed"&&hasPermission("rental.customerContact.update")&&<Link className="mt-3 inline-block rounded border border-blue-600 px-3 py-2 text-sm text-blue-700" to={`/rentals/${aggregate.rental.id}/customer-contact`}>Edit Customer Contact</Link>}
      <ApprovalInvalidationNotice rental={aggregate.rental} />
      {workflow.blockingReasons.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <b>Blocking reasons</b>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {workflow.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
