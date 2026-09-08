import { useEffect, useState } from "react";
import { PersistenceMode, useApplicationDependenciesCompatibility } from "@/app/composition";
import { useRentalWorkspaceAggregate } from "..";
import type { CanonicalRentalReturnEvidence } from "@/features/rental/remote/contracts";

function available(value: unknown[] | null) { return Array.isArray(value) && value.length === 1 && (value[0] as { available?: unknown }).available === true ? "Available" : Array.isArray(value) ? "Unavailable" : "Not applicable"; }

export default function RentalReturnEvidence() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const aggregate = useRentalWorkspaceAggregate();
  const [state,setState] = useState<{value?:CanonicalRentalReturnEvidence;error?:string}>({});
  const line = aggregate.rentalEquipmentLines[0];
  useEffect(() => {
    if (configuration.persistenceMode !== PersistenceMode.Remote || aggregate.rental.status !== "Returned" || !line || !commandRepositories.canonicalRental) { setState({}); return; }
    let current=true; setState({});
    void commandRepositories.canonicalRental.readReturnEvidence(aggregate.rental.id,line.id).then(result => { if(current) setState(result.success?{value:result.value}:{error:result.message}); }).catch(()=>{if(current)setState({error:"Return evidence could not be loaded."});});
    return ()=>{current=false;};
  },[aggregate.rental.id,aggregate.rental.status,commandRepositories.canonicalRental,configuration.persistenceMode,line?.id]);
  if (configuration.persistenceMode !== PersistenceMode.Remote || aggregate.rental.status !== "Returned" || !line) return null;
  if (state.error) return <section className="rounded border border-amber-300 bg-amber-50 p-4 text-sm" aria-label="Return evidence">Return evidence is unavailable: {state.error}</section>;
  if (!state.value) return <section className="rounded border p-4 text-sm" aria-label="Return evidence">Loading canonical Return evidence…</section>;
  const {rental,line:returned,assignment,availability}=state.value;
  return <section className="rounded border bg-slate-50 p-4 text-sm" aria-label="Return evidence"><h3 className="font-semibold">Return evidence</h3><dl className="mt-2 grid gap-2 sm:grid-cols-2"><div><dt>Rental status / version</dt><dd>{rental.status} / {rental.version}</dd></div><div><dt>Actual return date</dt><dd>{returned.actualReturnDate ?? "—"}</dd></div><div><dt>Line status</dt><dd>{returned.status}</dd></div><div><dt>Assignment returned date</dt><dd>{assignment?.returnedDate ?? "—"}</dd></div><div><dt>Availability on return date</dt><dd>{available(availability.onReturnDate)}</dd></div><div><dt>Availability next day</dt><dd>{available(availability.onNextDate)}</dd></div></dl></section>;
}
