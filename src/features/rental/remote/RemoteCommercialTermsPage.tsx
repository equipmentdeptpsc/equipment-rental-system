import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/components/ui/Button";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { useRental } from "@/features/rental/context/RentalContext";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useCustomer } from "@/features/customer/context/CustomerContext";
import { useRentalListData } from "@/features/rental/hooks/useRentalListData";
import { useCanonicalRentalReferenceData, useCanonicalRentalWorkspace } from "./useCanonicalRentalRemoteData";
import { requestCanonicalRentalRefresh } from "./canonicalRentalRefresh";
import { rentalBillingMethods, type RentalBillingMethod } from "@/features/rental/types";
import type { WorkDescriptionRecord } from "@/features/masters/work-description/types";
import { useAuth } from "@/features/auth/AuthContext";
import { canUseCanonicalRemoteRentalCommercialTermsMutation } from "@/features/rental/services/rentalRuntimeCapability";

interface Draft { billingMethod: RentalBillingMethod; currency: string; unitRate: string; operatorIncluded: boolean; costCodeId: string; activityCodeId: string; workDescriptionId: string; remarks: string }
const blank = (): Draft => ({ billingMethod: "Per Hour", currency: "PHP", unitRate: "", operatorIncluded: true, costCodeId: "", activityCodeId: "", workDescriptionId: "", remarks: "" });

export default function RemoteCommercialTermsPage({ rentalId }: { rentalId: string }) {
  const dependencies = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const editable = canUseCanonicalRemoteRentalCommercialTermsMutation(dependencies.configuration)
    && Boolean(dependencies.commandRepositories.canonicalRental)
    && hasPermission("rental.commercialTerms.update");
  const localRental = useRental(), localAssignments = useAssignment().assignments, localEquipment = useEquipment().equipment;
  const localOperators = useOperator().operators, localProjects = useProject().projects, localCustomers = useCustomer().customers;
  const fallback = useMemo(() => ({ rentals: localRental.rentals, rentalEquipmentLines: localRental.rentalEquipmentLines, assignments: localAssignments, equipment: localEquipment, operators: localOperators, projects: localProjects, customers: localCustomers, costCodes: [], activityCodes: [] }), [localRental.rentals, localRental.rentalEquipmentLines, localAssignments, localEquipment, localOperators, localProjects, localCustomers]);
  const list = useRentalListData(fallback), workspace = useCanonicalRentalWorkspace(rentalId), references = useCanonicalRentalReferenceData();
  const [workDescriptions, setWorkDescriptions] = useState<WorkDescriptionRecord[]>([]), [workError, setWorkError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const identity = useRef<{ commandId: string; idempotencyKey: string } | undefined>(undefined);
  useEffect(() => { let active = true; void Promise.resolve(dependencies.readRepositories.workDescriptions.list()).then(result => { if (!active) return; if (result.success) setWorkDescriptions(result.value.items.filter(item => item.active !== false)); else setWorkError("Work descriptions could not be loaded."); }); return () => { active = false; }; }, [dependencies.readRepositories.workDescriptions]);
  const rental = list.data.rentals.find(item => item.id === rentalId);
  const lines = useMemo(() => list.data.rentalEquipmentLines.filter(item => item.rentalId === rentalId), [list.data.rentalEquipmentLines, rentalId]);
  useEffect(() => {
    if (workspace.status !== "loaded" || references.status !== "loaded") return;
    setDrafts(current => { let next = current; for (const line of lines) { if (next[line.id]) continue; if (next === current) next = { ...current }; const contract = workspace.data.contracts.find(item => item.rentalEquipmentLineId === line.id); const equipment = list.data.equipment.find(item => item.id === line.equipmentId); const assignment = list.data.assignments.find(item => item.id === line.assignmentId); next[line.id] = { ...blank(), billingMethod: contract?.billingMethod ?? "Per Hour", currency: contract?.currency ?? "PHP", unitRate: contract ? String(contract.unitRate) : "", operatorIncluded: contract?.operatorIncluded ?? rental?.rentalType === "Operated Rental", costCodeId: equipment?.costCodeId ?? "", activityCodeId: assignment?.activityCodeId ?? "", workDescriptionId: line.deurWorkDescriptionId ?? "", remarks: contract?.remarks ?? "" }; } return next; });
  }, [lines, list.data.assignments, list.data.equipment, references.status, rental?.rentalType, workspace.status]);
  if (list.status === "loading" || workspace.status === "loading" || references.status === "loading") return <main className="p-8">Loading canonical commercial preparation…</main>;
  const error = list.status === "error" ? list.message : workspace.status === "error" ? workspace.message : references.status === "error" ? references.message : workError;
  if (error) return <main className="p-8" role="alert"><p className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error}</p><Button className="mt-3" onClick={() => { list.retry(); workspace.retry(); references.retry(); }}>Retry</Button></main>;
  if (!rental || workspace.status !== "loaded" || references.status !== "loaded") return <main className="p-8">Rental not found.</main>;
  const update = (lineId: string, change: Partial<Draft>) => setDrafts(value => ({ ...value, [lineId]: { ...(value[lineId] ?? blank()), ...change } }));
  async function save() {
    if (!editable) return;
    if (saving) return; setMessage("");
    if (typeof rental!.rowVersion !== "number") return setMessage("Canonical Rental version is unavailable. Refresh and try again.");
    const prepared = lines.map(line => ({ line, draft: drafts[line.id] })).filter(item => item.draft);
    if (prepared.length !== lines.length || prepared.some(({ draft }) => !draft.costCodeId || !draft.activityCodeId || !draft.workDescriptionId || !Number.isFinite(Number(draft.unitRate)))) return setMessage("Complete the commercial and operational preparation fields for every equipment line.");
    setSaving(true); const commandIdentity = identity.current ??= { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const result = await dependencies.commandRepositories.canonicalRental!.updateTerms({ ...commandIdentity, rentalId, expectedVersion: rental!.rowVersion, lines: prepared.map(({ line, draft }) => ({ lineId: line.id, commercialTerms: { billingMethod: draft.billingMethod, currency: draft.currency.trim().toUpperCase(), unitRate: Number(draft.unitRate), operatorIncluded: draft.operatorIncluded, transactionRelationship: "Non-Affiliate", vatApplicability: "Applicable", remarks: draft.remarks || undefined }, costCodeId: draft.costCodeId, activityCodeId: draft.activityCodeId, workDescriptionId: draft.workDescriptionId, deurPolicy: { frequency: rental!.deurExpectationPolicy?.frequency ?? "PER_WORKDAY", effectiveFrom: rental!.dateOut, expectedShiftCodes: rental!.deurExpectationPolicy?.expectedShiftCodes ?? [], timezone: rental!.deurExpectationPolicy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, capturedAt: new Date().toISOString() }, operationalRemarks: draft.remarks || undefined, meterRequirement: "none" })) });
    setSaving(false); if (!result.success) return setMessage(result.message); identity.current = undefined; requestCanonicalRentalRefresh(); setMessage("Commercial terms and DEUR preparation saved from the canonical service.");
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6"><header><Link className="text-blue-700" to={`/rentals/${rentalId}/workspace`}>← Rental Workspace</Link><h1 className="mt-2 text-3xl font-bold">Commercial Terms / DEUR Preparation</h1><p className="text-slate-600">{rental.rentalNumber ?? rental.id}</p></header>{!editable && <p className="rounded border border-blue-200 bg-blue-50 p-3 text-blue-800">Commercial Terms are read-only. Saving is not enabled for this session.</p>}{lines.map(line => { const draft = drafts[line.id] ?? blank(), equipment = list.data.equipment.find(item => item.id === line.equipmentId); return <section className="rounded-xl border bg-white p-5" key={line.id}><h2 className="font-semibold">{equipment ? `${equipment.assetNo} — ${equipment.equipmentName}` : line.equipmentId}</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">Billing Method<select disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.billingMethod} onChange={event => update(line.id, { billingMethod: event.target.value as RentalBillingMethod })}>{rentalBillingMethods.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm">Currency<input disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.currency} maxLength={3} onChange={event => update(line.id, { currency: event.target.value })}/></label><label className="text-sm">Unit Rate<input disabled={!editable} className="mt-1 block w-full rounded border p-2" type="number" min="0" value={draft.unitRate} onChange={event => update(line.id, { unitRate: event.target.value })}/></label><label className="flex items-center gap-2 text-sm"><input disabled={!editable} type="checkbox" checked={draft.operatorIncluded} onChange={event => update(line.id, { operatorIncluded: event.target.checked })}/>Operator Included</label><label className="text-sm">Cost Code<select disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.costCodeId} onChange={event => update(line.id, { costCodeId: event.target.value })}><option value="">Select…</option>{references.data.costCodes.map(value => <option key={value.id} value={value.id}>{value.code} — {value.name}</option>)}</select></label><label className="text-sm">Activity Code<select disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.activityCodeId} onChange={event => update(line.id, { activityCodeId: event.target.value })}><option value="">Select…</option>{references.data.activityCodes.map(value => <option key={value.id} value={value.id}>{value.code} — {value.name}</option>)}</select></label><label className="text-sm sm:col-span-2">Work Description<select disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.workDescriptionId} onChange={event => update(line.id, { workDescriptionId: event.target.value })}><option value="">Select…</option>{workDescriptions.map(value => <option key={value.id} value={value.id}>{value.code ? `${value.code} — ` : ""}{value.name}</option>)}</select></label><label className="text-sm sm:col-span-2">Operational / Commercial Remarks<textarea disabled={!editable} className="mt-1 block w-full rounded border p-2" value={draft.remarks} onChange={event => update(line.id, { remarks: event.target.value })}/></label></div></section>; })}{message && <p className="rounded border p-3" role="status">{message}</p>}{editable && <Button disabled={saving || lines.length === 0} onClick={save}>{saving ? "Saving…" : "Save Canonical Preparation"}</Button>}</main>;
}
