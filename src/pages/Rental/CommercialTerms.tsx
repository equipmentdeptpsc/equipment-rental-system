import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/toast/ToastContext";
import { useRental } from "@/features/rental/context/RentalContext";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { rentalBillingMethods, type RentalBillingMethod, type RentalRecord } from "@/features/rental/types";
import type { RentalEquipmentLine } from "@/features/rental/equipment-line";
import type { RentalContractRecord } from "@/features/rental/types/RentalContract";
import { canEditRentalCommercialTerms, type RentalCommercialTermsInput } from "@/features/rental/services/configureRentalCommercialTerms";
import { getCommercialConfigurationProgress, getNextUnconfiguredLine, isCommerciallyConfigured } from "@/features/rental/commercial/commercialConfigurationProgress";
import { resolveCommercialSummary } from "@/features/rental/commercial/resolveCommercialSummary";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseLegacyRentalMutations, REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE } from "@/features/rental/services/rentalRuntimeCapability";
import RemoteCommercialTermsPage from "@/features/rental/remote/RemoteCommercialTermsPage";
import { PersistenceMode } from "@/app/composition";

const optionalNumber = (value: string) => value.trim() === "" ? undefined : Number(value);
export const commercialRateLabel=(method:RentalBillingMethod)=>({
  "Per Hour":"Operating Rate","Per Day":"Daily Rate","Per Week":"Weekly Rate","Per Month":"Monthly Rate",
  "Per Trip":"Trip Rate","Per Kilometer":"Kilometer Rate","Per Cubic Meter":"Cubic Meter Rate","One Lot":"Contract Amount",
})[method];

export function LineTermsEditor({ rental, line, contract, equipmentLabel, operatorLabel, saveTerms, onSaved }: {
  rental: RentalRecord; line: RentalEquipmentLine; contract?: RentalContractRecord; equipmentLabel: string; operatorLabel: string;
  saveTerms: (input: RentalCommercialTermsInput) => { success: boolean; message?: string }; onSaved?(): void;
}) {
  const editable = canEditRentalCommercialTerms(rental) && !line.commercialSnapshot;
  const [billingMethod, setBillingMethod] = useState<RentalBillingMethod>(contract?.billingMethod ?? rental.billingMethod ?? "Per Hour");
  const [currency, setCurrency] = useState(contract?.currency ?? "PHP");
  const [unitRate, setUnitRate] = useState(contract ? String(contract.unitRate) : "");
  const [minimumBillableHours, setMinimumBillableHours] = useState(contract?.minimumBillableHours?.toString() ?? "");
  const [overtimeRate, setOvertimeRate] = useState(contract?.overtimeRate?.toString() ?? "");
  const [standbyRate, setStandbyRate] = useState(contract?.standbyRate?.toString() ?? "");
  const [mobilizationFee, setMobilizationFee] = useState(contract?.mobilizationFee?.toString() ?? "");
  const [demobilizationFee, setDemobilizationFee] = useState(contract?.demobilizationFee?.toString() ?? "");
  const [fuelCharge, setFuelCharge] = useState(contract?.fuelCharge?.toString() ?? "");
  const [operatorIncluded, setOperatorIncluded] = useState(contract?.operatorIncluded ?? rental.rentalType === "Operated Rental");
  const [operatorRate, setOperatorRate] = useState(contract?.operatorRate?.toString() ?? "");
  const [contractAmount, setContractAmount] = useState(contract?.contractAmount?.toString() ?? "");
  const [taxRate, setTaxRate] = useState(contract?.taxRate?.toString() ?? "");
  const [withholdingTax, setWithholdingTax] = useState(contract?.withholdingTax?.toString() ?? "");
  const [relationship, setRelationship] = useState<RentalCommercialTermsInput["transactionRelationship"]>(contract?.transactionRelationship ?? rental.transactionRelationship ?? "Non-Affiliate");
  const [vatApplicability, setVatApplicability] = useState<RentalCommercialTermsInput["vatApplicability"]>(contract?.vatApplicability ?? rental.billingTerms?.vatApplicability ?? "Applicable");
  const [remarks, setRemarks] = useState(contract?.remarks ?? "");
  const [includeMinimum,setIncludeMinimum]=useState(contract?.minimumBillableHours!==undefined);
  const [includeOvertime,setIncludeOvertime]=useState(contract?.overtimeRate!==undefined);
  const [includeStandby,setIncludeStandby]=useState(contract?.standbyRate!==undefined);
  const [includeMobilization,setIncludeMobilization]=useState(contract?.mobilizationFee!==undefined);
  const [includeDemobilization,setIncludeDemobilization]=useState(contract?.demobilizationFee!==undefined);
  const [includeFuel,setIncludeFuel]=useState(contract?.fuelCharge!==undefined);
  const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState(""); const submissionPending = useRef(false);
  async function save() {
    if (submissionPending.current) return;
    if(["Pending","Approved"].includes(rental.approvalStatus??"")&&!window.confirm("Saving material Commercial Terms changes will invalidate the current Manager approval request or approval. Continue?"))return;
    submissionPending.current = true; setSaving(true); setSaveError("");
    const result = await Promise.resolve(saveTerms({ billingMethod, currency, unitRate: billingMethod==="One Lot"?0:Number(unitRate), minimumBillableHours: includeMinimum?optionalNumber(minimumBillableHours):undefined, overtimeRate: includeOvertime?optionalNumber(overtimeRate):undefined, standbyRate: includeStandby?optionalNumber(standbyRate):undefined, mobilizationFee: includeMobilization?optionalNumber(mobilizationFee):undefined, demobilizationFee: includeDemobilization?optionalNumber(demobilizationFee):undefined, fuelCharge: includeFuel?optionalNumber(fuelCharge):undefined, operatorIncluded, operatorRate: operatorIncluded?undefined:optionalNumber(operatorRate), contractAmount: billingMethod==="One Lot"?optionalNumber(contractAmount):undefined, taxRate: vatApplicability==="Applicable"?optionalNumber(taxRate):undefined, withholdingTax: optionalNumber(withholdingTax), transactionRelationship: relationship, vatApplicability, remarks }));
    if (!result.success) { submissionPending.current = false; setSaving(false); setSaveError(result.message ?? "Unable to save commercial terms."); return; }
    onSaved?.();
  }
  const numberField = (label: string, value: string, setValue: (value: string) => void, required = false) => <label className="text-sm">{label}<input className="mt-1 block w-full rounded border p-2" type="number" min="0" step="any" required={required} disabled={!editable} value={value} onChange={(event) => setValue(event.target.value)} /></label>;
  return <section className="rounded-xl border bg-white p-6 shadow-sm">
    <div className="mb-4 rounded-lg bg-slate-50 p-4"><p className="font-semibold">{equipmentLabel}</p><p className="text-sm text-slate-600">Operator: {operatorLabel}</p><p className="text-xs text-slate-500">Rental Equipment Line · {line.status}</p></div>
    {!editable && <p className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-blue-800">🔒 Frozen — Commercial Terms are frozen after reservation preparation.</p>}
    {editable&&["Pending","Approved"].includes(rental.approvalStatus??"")&&<p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">Saving a material change will invalidate the current Manager approval state and require a new approval request.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <h3 className="border-b pb-2 font-semibold sm:col-span-2">A. Billing Basis</h3>
      <label className="text-sm">Billing Method<select className="mt-1 block w-full rounded border p-2" disabled={!editable} value={billingMethod} onChange={(event) => setBillingMethod(event.target.value as RentalBillingMethod)}>{rentalBillingMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
      <label className="text-sm">Currency<input className="mt-1 block w-full rounded border p-2" disabled={!editable} value={currency} onChange={(event) => setCurrency(event.target.value)} /></label>
      {billingMethod!=="One Lot"&&numberField(commercialRateLabel(billingMethod), unitRate, setUnitRate, true)}
      {billingMethod==="One Lot"&&numberField("Contract Amount", contractAmount, setContractAmount, true)}
      <label className="text-sm">Relationship<select className="mt-1 block w-full rounded border p-2" disabled={!editable} value={relationship} onChange={(event) => setRelationship(event.target.value as typeof relationship)}><option>Non-Affiliate</option><option>Affiliate</option></select></label>
      <label className="text-sm">VAT<select className="mt-1 block w-full rounded border p-2" disabled={!editable} value={vatApplicability} onChange={(event) => setVatApplicability(event.target.value as typeof vatApplicability)}><option>Applicable</option><option>Not Applicable</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeMinimum} onChange={e=>setIncludeMinimum(e.target.checked)}/> Apply Minimum Billable Hours</label>{includeMinimum&&numberField("Minimum Billable Hours",minimumBillableHours,setMinimumBillableHours)}
      <h3 className="mt-2 border-b pb-2 font-semibold sm:col-span-2">B. Additional Charges</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeOvertime} onChange={e=>setIncludeOvertime(e.target.checked)}/> Include Overtime</label>{includeOvertime&&numberField("Overtime Rate",overtimeRate,setOvertimeRate)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeStandby} onChange={e=>setIncludeStandby(e.target.checked)}/> Include Standby</label>{includeStandby&&numberField("Standby Rate",standbyRate,setStandbyRate)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeMobilization} onChange={e=>setIncludeMobilization(e.target.checked)}/> Include Mobilization</label>{includeMobilization&&numberField("Mobilization Fee",mobilizationFee,setMobilizationFee)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeDemobilization} onChange={e=>setIncludeDemobilization(e.target.checked)}/> Include Demobilization</label>{includeDemobilization&&numberField("Demobilization Fee",demobilizationFee,setDemobilizationFee)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={includeFuel} onChange={e=>setIncludeFuel(e.target.checked)}/> Include Fuel Charge</label>{includeFuel&&numberField("Fuel Charge",fuelCharge,setFuelCharge)}
      <h3 className="mt-2 border-b pb-2 font-semibold sm:col-span-2">C. Operator</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={operatorIncluded} onChange={(event) => setOperatorIncluded(event.target.checked)} /> Operator Included</label>
      {!operatorIncluded&&numberField("Operator Rate",operatorRate,setOperatorRate)}
      <h3 className="mt-2 border-b pb-2 font-semibold sm:col-span-2">D. Taxes</h3>{vatApplicability==="Applicable"&&numberField("Tax Rate (%)",taxRate,setTaxRate)}
      {numberField("Withholding Tax (%)",withholdingTax,setWithholdingTax)}
      <label className="sm:col-span-2 text-sm">Remarks<textarea className="mt-1 block w-full rounded border p-2" disabled={!editable} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
    </div>
    {saveError && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><strong className="block">Unable to save commercial terms.</strong>{saveError}</p>}
    {editable && <div className="mt-6 flex justify-end"><Button type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save This Line"}</Button></div>}
  </section>;
}

export default function RentalCommercialTermsPage() {
  const { configuration } = useApplicationDependenciesCompatibility();
  const mutationsAvailable = canUseLegacyRentalMutations(configuration);
  const { rentalId = "" } = useParams(); const { showToast } = useToast();
  const { getRental, rentalEquipmentLines, getContractForRentalEquipmentLine, saveCommercialTermsForRentalEquipmentLine, saveCommercialTermsForSelectedLines, addRentalEquipmentLine, removeRentalEquipmentLine } = useRental();
  const { equipment } = useEquipment(); const { operators } = useOperator(); const { assignments } = useAssignment();
  const rental = getRental(rentalId); const lines = rentalEquipmentLines.filter((line) => line.rentalId === rentalId);
  const contracts = lines.map((line) => getContractForRentalEquipmentLine(line.id)).filter((contract): contract is RentalContractRecord => Boolean(contract));
  const initiallyUnconfigured = getNextUnconfiguredLine(lines, contracts);
  const [selectedId, setSelectedId] = useState(initiallyUnconfigured?.id ?? lines[0]?.id ?? ""); const selected = lines.find((line) => line.id === selectedId) ?? lines[0];
  const [interaction, setInteraction] = useState<"configure" | "view" | "reconfigure">(initiallyUnconfigured ? "configure" : "view");
  const [promptLineId, setPromptLineId] = useState("");
  const [savedLineId, setSavedLineId] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const [bulkLineIds, setBulkLineIds] = useState<string[]>([]);
  useEffect(() => { if (savedLineId) resultRef.current?.focus({ preventScroll: false }); }, [savedLineId]);
  if (configuration.persistenceMode === PersistenceMode.Remote) return <RemoteCommercialTermsPage rentalId={rentalId}/>;
  if (!rental) return <div className="p-8">Rental not found.</div>;
  if (!mutationsAvailable) return <main className="p-8"><Link className="text-blue-700" to={`/rentals/${rental.id}/workspace`}>← Rental Workspace</Link><h1 className="mt-4 text-2xl font-bold">Commercial terms unavailable</h1><p className="mt-3 rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">{REMOTE_RENTAL_MUTATION_UNAVAILABLE_MESSAGE}</p></main>;
  const editable = canEditRentalCommercialTerms(rental);
  const progress = getCommercialConfigurationProgress(lines, contracts); const incompleteLines = lines.filter((line) => !isCommerciallyConfigured(line, contracts)); const allConfigured = progress.allConfigured;
  const promptLine = lines.find((line) => line.id === promptLineId); const promptEquipment = equipment.find((item) => item.id === promptLine?.equipmentId);
  const selectedContract = selected ? getContractForRentalEquipmentLine(selected.id) : undefined; const selectedTerms = selected?.commercialSnapshot ?? selectedContract; const selectedEquipment = equipment.find((item) => item.id === selected?.equipmentId);
  const availableAssignments = assignments.filter((assignment) => assignment.status === "Active" && assignment.projectId === rental.projectId && !lines.some((line) => line.equipmentId === assignment.equipmentId));
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <header><Link className="text-sm text-blue-700" to={`/rentals/${rentalId}/workspace`}>← Rental Workspace</Link><h1 className="mt-2 text-3xl font-bold">Commercial Terms by Equipment</h1><p className="mt-2 text-slate-600">{rental.rentalNumber ?? rental.id}</p></header>
    <section className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-semibold">Commercial Configuration</h2><p className="text-sm text-slate-600">{progress.configuredCount} of {progress.totalCount} equipment configured</p></div>{incompleteLines.length > 0 && <p className="text-sm font-medium text-amber-800">{incompleteLines.length} equipment {incompleteLines.length === 1 ? "item still requires" : "items still require"} commercial terms before release.</p>}</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{lines.map((line) => { const machine = equipment.find((item) => item.id === line.equipmentId); const contract=getContractForRentalEquipmentLine(line.id); const effective=line.commercialSnapshot??contract; const configured=Boolean(effective); return <button type="button" key={line.id} onClick={() => { if(configured){setPromptLineId(line.id);return;}setSelectedId(line.id);setInteraction("configure");setSavedLineId(""); }} className={`min-w-0 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected?.id === line.id ? "border-blue-500" : configured?"border-emerald-200":"border-amber-400"} ${configured?"bg-slate-50 text-slate-700 opacity-80":"bg-amber-50"}`}><strong className="block truncate">{machine ? `${machine.assetNo} — ${machine.equipmentName}` : line.equipmentId}</strong><span className={`mt-2 inline-block text-sm font-semibold ${configured?"text-emerald-700":"text-amber-800"}`}>{configured?line.commercialSnapshot?"✓ CONFIGURED · FROZEN":"✓ CONFIGURED":"○ UNCONFIGURED"}</span>{effective&&<p className="mt-1 text-sm"><span className="block">Billing Method: {effective.billingMethod}</span><span className="block">Rate: {(effective.currency??"PHP")} {(effective.unitRate??effective.contractAmount??0).toLocaleString()}</span></p>}<p className="mt-1 text-xs text-slate-500">Rental line status: {line.status}</p></button>; })}</div>
      {editable && availableAssignments.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{availableAssignments.map((assignment) => <Button key={assignment.id} type="button" onClick={() => { const result = addRentalEquipmentLine(rentalId, { equipmentId: assignment.equipmentId, operatorId: assignment.operatorId, assignmentId: assignment.id }); showToast(result.success ? "Equipment line added." : result.message ?? "Unable to add line.", result.success ? "success" : "error"); }}>Add {equipment.find((item) => item.id === assignment.equipmentId)?.assetNo ?? assignment.equipmentId}</Button>)}</div>}
      {editable && selected && <button aria-label="Remove Selected Line" className="mt-4 rounded border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50" type="button" onClick={() => { if(getContractForRentalEquipmentLine(selected.id)&&!window.confirm("Remove this equipment line and its saved Commercial Terms?"))return; const removedId=selected.id; const result = removeRentalEquipmentLine(rentalId, removedId); if (!result.success) { showToast(result.message ?? "Unable to remove line.", "error"); return; } setSelectedId(lines.find((line) => line.id !== removedId)?.id ?? ""); showToast("Equipment line removed.", "success"); }}>Remove selected line</button>}
    </section>
    {promptLine && <div role="dialog" aria-modal="true" aria-labelledby="configured-line-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><h2 id="configured-line-title" className="text-xl font-semibold">Commercial terms are already configured for this equipment.</h2><p className="mt-4 font-medium">{promptEquipment ? `${promptEquipment.equipmentName}` : promptLine.equipmentId}</p><p className="text-sm text-slate-600">Asset Number: {promptEquipment?.assetNo || "Not assigned"}</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" type="button" onClick={() => setPromptLineId("")}>Cancel</Button><Button variant="secondary" type="button" onClick={() => { setSelectedId(promptLine.id); setInteraction("view"); setSavedLineId(""); setPromptLineId(""); }}>View Commercial Terms</Button><Button type="button" disabled={Boolean(promptLine.commercialSnapshot)} title={promptLine.commercialSnapshot ? "Commercial terms are frozen after operational preparation." : undefined} onClick={() => { setSelectedId(promptLine.id); setInteraction("reconfigure"); setSavedLineId(""); setPromptLineId(""); }}>Reconfigure</Button></div></div></div>}
    {editable&&<section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Bulk Commercial Terms</h2><p className="mt-1 text-sm text-slate-600">Select eligible lines and copy the currently saved line terms. Frozen lines are excluded from bulk updates.</p><div className="my-3 flex flex-wrap gap-3">{lines.map(line=>{const frozen=Boolean(line.commercialSnapshot);return <label key={line.id} className={`flex items-center gap-2 text-sm ${frozen?"text-slate-500":""}`} title={frozen?"Commercial Terms are frozen after reservation preparation.":undefined}><input type="checkbox" disabled={frozen} checked={!frozen&&bulkLineIds.includes(line.id)} onChange={event=>setBulkLineIds(event.target.checked?[...bulkLineIds,line.id]:bulkLineIds.filter(id=>id!==line.id))}/>{equipment.find(item=>item.id===line.equipmentId)?.assetNo??line.equipmentId}{frozen&&<span className="text-xs">(Frozen)</span>}</label>})}</div><Button type="button" disabled={!selected||bulkLineIds.length===0||!getContractForRentalEquipmentLine(selected.id)} onClick={()=>{const source=selected?getContractForRentalEquipmentLine(selected.id):undefined;if(!source)return;const eligibleIds=bulkLineIds.filter(id=>!lines.find(line=>line.id===id)?.commercialSnapshot);const result=saveCommercialTermsForSelectedLines(rentalId,eligibleIds,{billingMethod:source.billingMethod,currency:source.currency,unitRate:source.unitRate,minimumBillableHours:source.minimumBillableHours,overtimeRate:source.overtimeRate,standbyRate:source.standbyRate,mobilizationFee:source.mobilizationFee,demobilizationFee:source.demobilizationFee,fuelCharge:source.fuelCharge,operatorIncluded:source.operatorIncluded,operatorRate:source.operatorRate,contractAmount:source.contractAmount,taxRate:source.taxRate,withholdingTax:source.withholdingTax,transactionRelationship:source.transactionRelationship??"Non-Affiliate",vatApplicability:source.vatApplicability??"Applicable",remarks:source.remarks});showToast(result.success?`Commercial terms applied to ${eligibleIds.length} selected lines.`:result.message??"Unable to apply commercial terms.",result.success?"success":"error");if(result.success)setBulkLineIds([])}}>Configure Selected Lines</Button></section>}
    {editable && bulkLineIds.length > 0 && <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><h2 className="font-semibold">Selected Equipment ({bulkLineIds.length})</h2><div className="mt-2 space-y-1 text-sm">{bulkLineIds.map((id) => { const line=lines.find((item)=>item.id===id); const machine=equipment.find((item)=>item.id===line?.equipmentId); return <p key={id}>{machine?`${machine.assetNo} — ${machine.equipmentName}`:line?.equipmentId??id}</p>; })}</div></section>}
    {editable && <BulkTermsCopyPanel
      lines={lines}
      selected={selected}
      contractsForLine={getContractForRentalEquipmentLine}
      selectedIds={bulkLineIds}
      setSelectedIds={setBulkLineIds}
      equipmentLabel={id => equipment.find(item => item.id === id)?.assetNo ?? id}
      apply={(ids, input) => saveCommercialTermsForSelectedLines(rentalId, ids, input)}
      notify={showToast}
    />}
    {selected && selectedTerms && (interaction === "view" || savedLineId === selected.id) &&
      <section ref={resultRef} tabIndex={-1} aria-live="polite" className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 outline-none focus:ring-2 focus:ring-emerald-600">
        <h2 className="text-xl font-semibold text-emerald-950">{savedLineId === selected.id ? "Commercial Terms Saved" : "Commercial Terms"}</h2>
        {savedLineId === selected.id && <p className="mt-1 text-emerald-800">Commercial terms saved successfully.</p>}
        <CommercialTermsSummary terms={selectedTerms} equipmentLabel={selectedEquipment?.equipmentName ?? selected.equipmentId} assetNo={selectedEquipment?.assetNo}/>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!allConfigured && <Button type="button" onClick={() => { const next=getNextUnconfiguredLine(lines,contracts,selected.id); if(next){setSelectedId(next.id);setInteraction("configure");setSavedLineId("");} }}>Configure Next Equipment</Button>}
          <Button variant="secondary" type="button" onClick={() => { const next=getNextUnconfiguredLine(lines,contracts); if(next){setSelectedId(next.id);setInteraction("configure");} setSavedLineId(""); }}>Choose Another Equipment</Button>
          <Link className="rounded bg-slate-800 px-4 py-2 text-center text-sm font-medium text-white" to={`/rentals/${rentalId}/workspace`}>Continue to Rental Workspace</Link>
          {allConfigured && <Button variant="secondary" type="button" onClick={() => { setSavedLineId(""); setInteraction("view"); }}>Review Commercial Terms</Button>}
        </div>
        {allConfigured && <p className="mt-4 font-semibold text-emerald-900">All equipment commercial terms are configured.</p>}
      </section>}
    {selected && (!selectedTerms || interaction === "reconfigure") && savedLineId !== selected.id ? <LineTermsEditor key={`${selected.id}:${interaction}:${selectedContract?.updatedAt ?? "new"}`} rental={rental} line={selected} contract={selectedContract} equipmentLabel={selectedEquipment?.assetNo ?? selected.equipmentId} operatorLabel={operators.find((item) => item.id === selected.operatorId)?.name ?? selected.operatorId} saveTerms={(input) => { const result = saveCommercialTermsForRentalEquipmentLine(rentalId, selected.id, input); if (!result.success) { showToast(result.message ?? "Unable to save commercial terms.", "error"); } return result; }} onSaved={() => { setSavedLineId(selected.id); setInteraction("view"); showToast("Commercial terms saved successfully.", "success"); }} /> : !selected && <p className="rounded border border-amber-300 bg-amber-50 p-4">This Rental has no equipment lines and cannot be released.</p>}
  </div>;
}

function BulkTermsCopyPanel({lines,selected,contractsForLine,selectedIds,setSelectedIds,equipmentLabel,apply,notify}:{lines:RentalEquipmentLine[];selected?:RentalEquipmentLine;contractsForLine(id:string):RentalContractRecord|undefined;selectedIds:string[];setSelectedIds(value:string[]):void;equipmentLabel(id:string):string;apply(ids:string[],input:RentalCommercialTermsInput):{success:boolean;message?:string};notify(message:string,type:"success"|"error"):void}){
  void lines; void selected; void contractsForLine; void selectedIds; void setSelectedIds; void equipmentLabel; void apply; void notify;
  return null;
}

function CommercialTermsSummary({ terms, equipmentLabel, assetNo }: { terms: RentalContractRecord | NonNullable<RentalEquipmentLine["commercialSnapshot"]>; equipmentLabel: string; assetNo?: string }) {
  const rows = resolveCommercialSummary(terms);
  const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: terms.currency || "PHP" }).format(value);
  return <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs uppercase text-slate-500">Equipment</dt><dd className="font-semibold">{equipmentLabel}</dd>{assetNo && <dd className="text-sm text-slate-600">Asset No. {assetNo}</dd>}</div><div><dt className="text-xs uppercase text-slate-500">Billing Method</dt><dd className="font-semibold">{terms.billingMethod}</dd></div>{rows.map((row) => <div key={row.key}><dt className="text-xs uppercase text-slate-500">{row.label}</dt><dd className="font-semibold">{row.kind === "money" ? money(row.value) : `${row.value} hours`}</dd></div>)}<div><dt className="text-xs uppercase text-slate-500">Operator</dt><dd className="font-semibold">{terms.operatorIncluded ? "Included" : "Excluded"}</dd></div>{typeof terms.taxRate === "number" && <div><dt className="text-xs uppercase text-slate-500">Tax Rate</dt><dd className="font-semibold">{terms.taxRate}%</dd></div>}{typeof terms.withholdingTax === "number" && <div><dt className="text-xs uppercase text-slate-500">Withholding Tax</dt><dd className="font-semibold">{terms.withholdingTax}%</dd></div>}</div>;
}
