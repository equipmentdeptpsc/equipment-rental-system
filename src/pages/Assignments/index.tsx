import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Rows3 } from "lucide-react";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useCanonicalAssignmentData, type CanonicalAssignmentData } from "@/features/assignment/hooks/useCanonicalAssignmentData";
import { getAssignmentRuntimeCapability, REMOTE_ASSIGNMENT_MUTATION_UNAVAILABLE_MESSAGE } from "@/features/assignment/services/assignmentRuntimeCapability";
import type { AssignmentRecord } from "@/features/assignment/types";
import { displayAssignmentDate, displayAssignmentExpectedReturn, getAssignmentNumber } from "@/features/assignment/utils/assignmentDisplay";
import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useAuth } from "@/features/auth/AuthContext";
import FilterBar from "@/components/ui/FilterBar";
import StatusBadge from "@/components/ui/StatusBadge";
import { canonicalBookingStatuses, type CanonicalBookingListItem, type CanonicalBookingPage, type CanonicalBookingSearchInput, type CanonicalBookingOperationalSearchInput } from "@/features/booking/canonical";

export default function Assignments() {
  const { configuration } = useApplicationDependenciesCompatibility();
  return getAssignmentRuntimeCapability(configuration).canonicalReads ? <RemoteAssignments /> : <LocalAssignments />;
}

function RemoteAssignments() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const state = useCanonicalAssignmentData();
  if (state.status === "loading") return <div className="p-8 text-slate-500">Loading canonical Assignments…</div>;
  if (state.status === "error") return <div className="p-8" role="alert">{state.message}<button className="ml-3 underline" onClick={state.retry}>Retry</button></div>;
  const canCreate = getAssignmentRuntimeCapability(configuration, Boolean(commandRepositories.canonicalAssignment)).canonicalCreation && hasPermission("assignment.create");
  return <div className="app-page"><PageHeader title="Bookings" description="Coordinate equipment, operators, and projects across assignments and rental lines." actions={canCreate ? <Link to="/assignments/new"><Button className="bg-[#f0a93a] text-[#071a33] hover:bg-[#d99a2f]">New Booking</Button></Link> : undefined} />{!canCreate && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">{REMOTE_ASSIGNMENT_MUTATION_UNAVAILABLE_MESSAGE}</p>}{state.status === "empty" ? <div className="app-card p-10 text-center text-slate-500">No canonical Bookings found.</div> : <RemoteBookingTabs data={state.data} />}</div>;
}

function RemoteBookingTabs({ data }: { data: CanonicalAssignmentData }) {
  const [tab, setTab] = useState<"assignments" | "rentals">("assignments");
  return <div className="space-y-4"><div className="app-card flex flex-wrap gap-1 p-2" role="tablist" aria-label="Booking views"><button type="button" role="tab" aria-selected={tab === "assignments"} className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "assignments" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`} onClick={() => setTab("assignments")}>Assignments</button><button type="button" role="tab" aria-selected={tab === "rentals"} className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "rentals" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`} onClick={() => setTab("rentals")}>Rental Bookings</button></div>{tab === "assignments" ? <RemoteAssignmentSections data={data} /> : <RentalBookingsView />}</div>;
}

type RentalBookingView = "list" | "calendar" | "agenda" | "operations";
type OperationsHorizon = "today" | "7" | "14" | "30";

const operationWindow = (horizon: OperationsHorizon) => {
  const start = new Date().toISOString().slice(0, 10);
  const days = horizon === "today" ? 0 : Number(horizon) - 1;
  return { start, end: shiftDate(start, days) };
};

function RentalBookingsView() {
  const { readRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const canReadCustomer = hasPermission("customer.read"), canReadProject = hasPermission("project.read"), canReadEquipment = hasPermission("equipment.read");
  const [filters, setFilters] = useState<CanonicalBookingSearchInput>({ limit: 25, sort: "createdAt" });
  const [page, setPage] = useState<CanonicalBookingPage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [optionState, setOptionState] = useState<{ customers: Array<[string, string]>; projects: Array<[string, string]>; equipment: Array<[string, string]> }>({ customers: [], projects: [], equipment: [] });
  const [view, setView] = useState<RentalBookingView>("list");
  const load = async (input: CanonicalBookingSearchInput) => { setStatus("loading"); const response = await readRepositories.canonicalBookings.searchCanonicalBookingRows(input); if (response.success) { setPage(response.value); setError(""); setStatus("ready"); } else { setPage(null); setError(response.error.message); setStatus("error"); } };
  useEffect(() => { if (view === "list") void load(filters); }, [filters, view]);
  useEffect(() => {
    let active = true;
    const loadOptions = async () => {
      const [customers, projects, equipment] = await Promise.all([
        canReadCustomer ? readRepositories.customers.list({ paging: { limit: 100 }, ordering: [{ field: "name", ascending: true }] }) : Promise.resolve(null),
        canReadProject ? readRepositories.projects.list({ paging: { limit: 100 }, ordering: [{ field: "name", ascending: true }] }) : Promise.resolve(null),
        canReadEquipment ? readRepositories.equipment.list({ paging: { limit: 100 }, ordering: [{ field: "equipmentName", ascending: true }] }) : Promise.resolve(null),
      ]);
      if (!active) return;
      setOptionState({
        customers: customers?.success ? customers.value.items.flatMap((item) => item.id && item.companyName ? [[item.id, item.companyName] as [string, string]] : []) : [],
        projects: projects?.success ? projects.value.items.flatMap((item) => item.id && item.projectName ? [[item.id, `${item.projectCode} · ${item.projectName}`] as [string, string]] : []) : [],
        equipment: equipment?.success ? equipment.value.items.flatMap((item) => item.id && item.equipmentName ? [[item.id, `${item.assetNo ? `${item.assetNo} · ` : ""}${item.equipmentName}`] as [string, string]] : []) : [],
      });
    };
    void loadOptions();
    return () => { active = false; };
  }, [canReadCustomer, canReadProject, canReadEquipment, readRepositories]);
  const setFilter = (key: keyof CanonicalBookingSearchInput, value: string) => { setPage(null); const normalized = key === "projectId" ? projects.find(([, label]) => label === value)?.[0] ?? value : value; setFilters((current) => ({ ...current, [key]: normalized || undefined, offset: 0 })); };
  const customers = optionState.customers, projects = optionState.projects, equipment = optionState.equipment;
  const reset = () => setFilters({ limit: 25, sort: "createdAt", offset: 0 });
  const totalPages = page ? Math.max(1, Math.ceil(page.totalCount / page.limit)) : 1;
  const currentPage = page ? Math.floor(page.offset / page.limit) + 1 : 1;
  const filterBar = <div className="app-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Search Rental Number<input aria-label="Search Rental Number" className="app-control mt-1 w-full" value={filters.rentalNumberSearch ?? ""} onChange={(event) => setFilter("rentalNumberSearch", event.target.value)} placeholder="Search Rental Number" /></label><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Status<select aria-label="Rental status" className="app-control mt-1 w-full" value={filters.status ?? ""} onChange={(event) => setFilter("status", event.target.value)}><option value="">All statuses</option>{canonicalBookingStatuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{hasPermission("customer.read") && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Customer<select aria-label="Rental customer" className="app-control mt-1 w-full" value={filters.customerId ?? ""} onChange={(event) => setFilter("customerId", event.target.value)}><option value="">All customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}{hasPermission("project.read") && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Project<select aria-label="Rental project" className="app-control mt-1 w-full" value={filters.projectId ?? ""} onChange={(event) => setFilter("projectId", event.target.value)}><option value="">All projects</option>{projects.map(([id, name]) => <option key={id} value={name}>{name}</option>)}</select></label>}{hasPermission("equipment.read") && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Equipment<select aria-label="Rental equipment" className="app-control mt-1 w-full" value={filters.equipmentId ?? ""} onChange={(event) => setFilter("equipmentId", event.target.value)}><option value="">All equipment</option>{equipment.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>} {view === "list" && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Sort<select aria-label="Rental booking sort" className="app-control mt-1 w-full" value={filters.sort ?? "createdAt"} onChange={(event) => setFilter("sort", event.target.value)}><option value="createdAt">Newest</option><option value="dateOut">Date Out</option><option value="expectedReturn">Expected Return</option><option value="rentalStatus">Status</option></select></label>}<Button variant="secondary" className="self-end" onClick={reset}>Reset</Button></div>;
  return <section aria-label="Rental Bookings" className="space-y-4"><div><h2 className="font-display text-lg font-semibold">Rental Bookings</h2><p className="text-sm text-slate-500">One row per Rental Equipment Line, read from the canonical projection.</p></div><RentalBookingViewSelector view={view} setView={setView} />{view === "operations" ? <OperationalQueues optionState={optionState} permissions={{ customer: canReadCustomer, project: canReadProject, equipment: canReadEquipment }} /> : <>{filterBar}{view === "list" ? <>{status === "loading" && <div className="app-card p-6 text-sm text-slate-500" role="status">Loading rental bookings…</div>}{status === "error" && <div className="app-card p-6 text-sm text-rose-700" role="alert">{error}<button className="ml-3 underline" onClick={() => void load(filters)}>Retry</button></div>}{status === "ready" && <><RentalBookingTable rows={page?.rows ?? []} /><div className="flex items-center justify-center gap-3"><Button variant="secondary" disabled={currentPage <= 1} onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - (current.limit ?? 25)) }))}>Previous</Button><span className="text-sm">Page {currentPage} of {totalPages} · {page?.totalCount ?? 0} bookings</span><Button variant="secondary" disabled={!page?.hasMore} onClick={() => setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + (current.limit ?? 25) }))}>Next</Button></div></>}</> : <RentalCalendarAgendaView mode={view} filters={filters} />}</>}</section>;
}

type OptionState = { customers: Array<[string, string]>; projects: Array<[string, string]>; equipment: Array<[string, string]> };
function OperationalQueues({ optionState, permissions }: { optionState: OptionState; permissions: { customer: boolean; project: boolean; equipment: boolean } }) {
  const { readRepositories } = useApplicationDependenciesCompatibility();
  const [horizon, setHorizon] = useState<OperationsHorizon>("7");
  const [filters, setFilters] = useState<CanonicalBookingOperationalSearchInput>({ windowStart: "", windowEnd: "", limit: 25, offset: 0 });
  const [upcoming, setUpcoming] = useState<{ status: "loading" | "ready" | "error"; page: CanonicalBookingPage | null; error: string }>({ status: "loading", page: null, error: "" });
  const [expected, setExpected] = useState<{ status: "loading" | "ready" | "error"; page: CanonicalBookingPage | null; error: string }>({ status: "loading", page: null, error: "" });
  const window = operationWindow(horizon);
  const load = async (queue: "upcoming" | "expected", retry = false) => {
    const input = { ...filters, windowStart: window.start, windowEnd: window.end, offset: retry ? filters.offset : 0 };
    (queue === "upcoming" ? setUpcoming : setExpected)((current) => ({ ...current, status: "loading", error: "" }));
    const response = queue === "upcoming" ? await readRepositories.canonicalBookings.searchCanonicalUpcomingReleaseRows(input) : await readRepositories.canonicalBookings.searchCanonicalExpectedReturnRows(input);
    (queue === "upcoming" ? setUpcoming : setExpected)(response.success ? { status: "ready", page: response.value, error: "" } : { status: "error", page: null, error: response.error.message });
  };
  useEffect(() => { void load("upcoming"); void load("expected"); }, [horizon, filters.customerId, filters.projectId, filters.equipmentId, filters.rentalNumberSearch, filters.offset]);
  const update = (key: keyof CanonicalBookingOperationalSearchInput, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined, offset: 0 }));
  const controls = <div className="app-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Period<select aria-label="Operations horizon" className="app-control mt-1 w-full" value={horizon} onChange={(e) => { setHorizon(e.target.value as OperationsHorizon); setFilters((f) => ({ ...f, offset: 0 })); }}><option value="today">Today</option><option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option></select></label><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Customer<select aria-label="Operations customer" className="app-control mt-1 w-full" value={filters.customerId ?? ""} onChange={(e) => update("customerId", e.target.value)}><option value="">All customers</option>{permissions.customer && optionState.customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Project<select aria-label="Operations project" className="app-control mt-1 w-full" value={filters.projectId ?? ""} onChange={(e) => update("projectId", e.target.value)}><option value="">All projects</option>{permissions.project && optionState.projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Equipment<select aria-label="Operations equipment" className="app-control mt-1 w-full" value={filters.equipmentId ?? ""} onChange={(e) => update("equipmentId", e.target.value)}><option value="">All equipment</option>{permissions.equipment && optionState.equipment.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>;
  const panel = (queue: "upcoming" | "expected", title: string, empty: string) => { const state = queue === "upcoming" ? upcoming : expected; const rows = state.page?.rows ?? []; const pageNumber = state.page ? Math.floor(state.page.offset / state.page.limit) + 1 : 1; const totalPages = state.page ? Math.max(1, Math.ceil(state.page.totalCount / state.page.limit)) : 1; return <section className="app-card min-w-0 overflow-hidden" aria-labelledby={`${queue}-heading`}><div className="border-b border-slate-200 p-4 dark:border-slate-700"><h3 id={`${queue}-heading`} className="font-display text-lg font-semibold">{title}</h3><p className="text-xs text-slate-500">Next {horizon === "today" ? "day" : `${horizon} days`} · read-only</p></div>{state.status === "loading" && <div role="status" className="p-6 text-sm text-slate-500">Loading {title.toLowerCase()}…</div>}{state.status === "error" && <div role="alert" className="p-6 text-sm text-rose-700">{state.error}<button className="ml-3 underline" onClick={() => void load(queue, true)}>Retry</button></div>}{state.status === "ready" && (!rows.length ? <div className="p-8 text-center text-sm text-slate-500">{filters.customerId || filters.projectId || filters.equipmentId ? "No records match the selected filters" : empty}</div> : <><div className="overflow-x-auto"><table className="app-table min-w-full text-left text-sm"><thead><tr>{(queue === "upcoming" ? ["Rental #", "Equipment", "Customer", "Project", "Status", "Date Out"] : ["Rental #", "Equipment", "Customer", "Project", "Status", "Expected Return", "Date Out"]).map((label) => <th key={label} className="p-3">{label}</th>)}<th className="p-3">Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rentalEquipmentLineId} className="align-top"><td className="p-3 font-semibold">{row.rentalNumber ?? "—"}</td><td className="p-3">{row.equipmentName ?? "—"}</td><td className="p-3">{row.customerName ?? "—"}</td><td className="p-3">{row.projectName ?? "—"}</td><td className="p-3"><StatusBadge tone="neutral">{row.rentalStatus}</StatusBadge></td>{queue === "upcoming" ? <td className="p-3">{row.dateOut.slice(0, 10)}</td> : <><td className="p-3">{row.expectedReturn?.slice(0, 10) ?? "—"}</td><td className="p-3">{row.dateOut.slice(0, 10)}</td></>}<td className="p-3"><Link className="text-blue-600 hover:underline" to={`/rentals/${row.rentalId}`}>Open Rental</Link></td></tr>)}</tbody></table></div><div className="flex items-center justify-center gap-3 border-t border-slate-200 p-3 text-sm dark:border-slate-700"><Button variant="secondary" disabled={pageNumber <= 1} onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - (current.limit ?? 25)) }))}>Previous</Button><span>Page {pageNumber} of {totalPages} · {state.page?.totalCount ?? 0} records</span><Button variant="secondary" disabled={!state.page?.hasMore} onClick={() => setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + (current.limit ?? 25) }))}>Next</Button></div></>)}</section>; };
  return <div className="space-y-4"><div><h3 className="font-display text-lg font-semibold">Operations</h3><p className="text-sm text-slate-500">Bounded upcoming release and expected return queues.</p></div>{controls}<div className="grid items-start gap-4 xl:grid-cols-2">{panel("upcoming", "Upcoming Releases", "No upcoming releases in this period")}{panel("expected", "Expected Returns", "No expected returns in this period")}</div></div>;
}

function RentalBookingViewSelector({ view, setView }: { view: RentalBookingView; setView: (view: RentalBookingView) => void }) {
  return <div className="app-card flex flex-wrap gap-1 p-2" role="tablist" aria-label="Rental booking views">{(["list", "calendar", "agenda", "operations"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={view === key} className={`rounded-md px-4 py-2 text-sm font-medium ${view === key ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white"}`} onClick={() => setView(key)}>{key === "operations" ? "Operations" : key[0].toUpperCase() + key.slice(1)}</button>)}</div>;
}

const calendarDate = (value: Date) => value.toISOString().slice(0, 10);
const shiftDate = (value: string, days: number) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return calendarDate(date); };
const monthWindow = (month: string) => { const first = `${month}-01`; const firstDate = new Date(`${first}T00:00:00.000Z`); const start = shiftDate(first, -firstDate.getUTCDay()); const last = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)); const end = shiftDate(calendarDate(last), 6 - last.getUTCDay()); return { start, end }; };
const effectiveBookingEnd = (row: CanonicalBookingListItem) => (row.actualReturn ?? row.expectedReturn ?? row.dateOut).slice(0, 10);

function RentalCalendarAgendaView({ mode, filters }: { mode: "calendar" | "agenda"; filters: CanonicalBookingSearchInput }) {
  const { readRepositories } = useApplicationDependenciesCompatibility();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; page: CanonicalBookingPage | null; error: string }>({ status: "loading", page: null, error: "" });
  const window = monthWindow(month);
  useEffect(() => { let active = true; setState({ status: "loading", page: null, error: "" }); void readRepositories.canonicalBookings.searchCanonicalBookingCalendarRows({ ...filters, sort: "dateOut", ascending: true, offset: 0, limit: 100, windowStart: window.start, windowEnd: window.end }).then((response) => { if (!active) return; setState(response.success ? { status: "ready", page: response.value, error: "" } : { status: "error", page: null, error: response.error.message }); }); return () => { active = false; }; }, [filters, month, readRepositories, window.end, window.start]);
  return <section aria-label={mode === "calendar" ? "Rental booking calendar" : "Rental booking agenda"} className="app-card space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-lg font-semibold">{mode === "calendar" ? "Calendar" : "Agenda"}</h3><div className="flex items-center gap-2"><Button variant="secondary" aria-label="Previous month" onClick={() => setMonth((value) => shiftDate(`${value}-01`, -1).slice(0, 7))}><ChevronLeft size={16} aria-hidden="true" />Previous</Button><Button variant="secondary" onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Today</Button><Button variant="secondary" aria-label="Next month" onClick={() => setMonth((value) => shiftDate(`${value}-01`, 32).slice(0, 7))}>Next<ChevronRight size={16} aria-hidden="true" /></Button></div></div>{state.status === "loading" && <div role="status" className="py-8 text-center text-sm text-slate-500">Loading rental bookings…</div>}{state.status === "error" && <div role="alert" className="py-8 text-center text-sm text-rose-700">{state.error}<button className="ml-3 underline" onClick={() => setMonth((value) => value)}>Retry</button></div>}{state.status === "ready" && (mode === "calendar" ? <RentalMonthGrid rows={state.page?.rows ?? []} month={month} /> : <RentalAgenda rows={state.page?.rows ?? []} />)}</section>;
}

function RentalMonthGrid({ rows, month }: { rows: readonly CanonicalBookingListItem[]; month: string }) {
  const window = monthWindow(month); const dates = Array.from({ length: 42 }, (_, index) => shiftDate(window.start, index));
  if (!rows.length) return <div className="py-8 text-center text-sm text-slate-500">No rental bookings in this period</div>;
  return <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7" aria-label={`Bookings for ${month}`}>{dates.map((date) => { const dayRows = rows.filter((row) => row.dateOut.slice(0, 10) <= date && effectiveBookingEnd(row) >= date); return <div key={date} className="min-h-24 bg-white p-2 dark:bg-slate-900"><p className="mb-1 text-xs font-semibold text-slate-500">{date}</p><div className="space-y-1">{dayRows.slice(0, 3).map((row) => <Link key={row.rentalEquipmentLineId} to={`/rentals/${row.rentalId}`} className="block truncate rounded bg-slate-100 px-1.5 py-1 text-xs text-slate-800 hover:bg-amber-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-amber-950/40" title={`${row.rentalNumber ?? "Rental"} · ${row.equipmentName ?? "Equipment"} · ${row.rentalStatus}`}>{row.rentalNumber ?? "Rental"} · {row.equipmentName ?? "Equipment"} · {row.rentalStatus}</Link>)}{dayRows.length > 3 && <p className="text-xs text-slate-500">+{dayRows.length - 3} more</p>}</div></div>; })}</div>;
}

function RentalAgenda({ rows }: { rows: readonly CanonicalBookingListItem[] }) {
  if (!rows.length) return <div className="py-8 text-center text-sm text-slate-500">No rental bookings in this period</div>;
  const groups = new Map<string, CanonicalBookingListItem[]>(); rows.forEach((row) => { const key = row.dateOut.slice(0, 10); groups.set(key, [...(groups.get(key) ?? []), row]); });
  return <div className="space-y-4">{[...groups.entries()].map(([date, dayRows]) => <section key={date} aria-labelledby={`agenda-${date}`}><h4 id={`agenda-${date}`} className="font-display font-semibold">{date}</h4><div className="mt-2 space-y-2">{dayRows.map((row) => <Link key={row.rentalEquipmentLineId} to={`/rentals/${row.rentalId}`} className="block rounded-lg border border-slate-200 p-3 hover:bg-amber-50 dark:border-slate-700 dark:hover:bg-amber-950/20"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.rentalNumber ?? "Rental"}</strong><StatusBadge tone="neutral">{row.rentalStatus}</StatusBadge></div><p className="text-sm">{row.equipmentName ?? "Equipment"} · {row.customerName ?? "Customer"} · {row.projectName ?? "Project"}</p><p className="text-xs text-slate-500">Date Out: {row.dateOut.slice(0, 10)} · Expected Return: {row.actualReturn?.slice(0, 10) ?? row.expectedReturn?.slice(0, 10) ?? "—"}</p></Link>)}</div></section>)}</div>;
}

function RentalBookingTable({ rows }: { rows: readonly CanonicalBookingListItem[] }) {
  if (!rows.length) return <div className="app-card p-8 text-center text-slate-500">No rental bookings found.</div>;
  return <ResponsiveTable><div className="app-card min-w-[760px] overflow-hidden"><table className="app-table w-full text-left text-sm"><thead><tr>{["Rental #", "Equipment", "Customer", "Project", "Status", "Date Out", "Expected Return", "Action"].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.rentalEquipmentLineId} className="align-top"><td className="p-3 font-semibold text-blue-600">{row.rentalNumber ?? "—"}</td><td className="p-3"><span className="block font-medium">{row.equipmentName ?? "—"}</span><span className="block text-xs text-slate-500">{row.equipmentAssetNumber ?? "—"}</span></td><td className="p-3">{row.customerName ?? "—"}</td><td className="p-3">{row.projectName ?? "—"}</td><td className="p-3"><StatusBadge tone="neutral">{row.rentalStatus}</StatusBadge></td><td className="p-3">{row.dateOut.slice(0, 10)}</td><td className="p-3">{row.expectedReturn?.slice(0, 10) ?? "—"}</td><td className="p-3"><Link className="text-blue-600 hover:underline" to={`/rentals/${row.rentalId}`}>Open Rental</Link></td></tr>)}</tbody></table></div></ResponsiveTable>;
}

function RemoteAssignmentSections({ data }: { data: CanonicalAssignmentData }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<AssignmentView>("list");
  const current = data.assignments.filter((item) => item.status === "Active");
  const overdue = current.filter((item) => assignmentViewStatus(item) === "Overdue");
  const history = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.assignments.filter((item) => item.status !== "Active").filter((item) => remoteSearchText(item, data).includes(normalized));
  }, [data, query]);
  return <><AssignmentToolbar view={view} setView={setView} /><section className="space-y-3"><h2 className="font-display text-lg font-semibold">Current Bookings ({current.length})</h2>{overdue.length > 0 && <div className="flex items-start gap-3 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm text-amber-900"><span>⚠</span><p><strong>{overdue.length} {overdue.length === 1 ? "booking is" : "bookings are"} overdue for return.</strong> Review the highlighted records below.</p></div>}{view === "list" ? remoteTable(current, data, "No current Bookings.") : <AssignmentBoard records={current} data={data} view={view} />}</section><section className="space-y-3"><div><h2 className="font-display text-lg font-semibold">Completed / History ({history.length})</h2><p className="text-sm text-slate-500">Completed and cancelled canonical records remain available for audit.</p></div><FilterBar onClear={()=>setQuery("")} canClear={Boolean(query)}><label className="min-w-[16rem] flex-1 text-xs font-medium text-slate-600 dark:text-slate-300"><span className="block">Search history</span><input aria-label="Search completed assignments" className="app-control mt-1 w-full" onChange={(event) => setQuery(event.target.value)} placeholder="Assignment, equipment, operator, or project" value={query} /></label></FilterBar>{remoteTable(history, data, "No completed or cancelled Bookings match.")}</section></>;
}

function remoteSearchText(assignment: AssignmentRecord, data: CanonicalAssignmentData) {
  const equipment = data.equipment.find((item) => item.id === assignment.equipmentId), operator = data.operators.find((item) => item.id === assignment.operatorId), project = data.projects.find((item) => item.id === assignment.projectId);
  return `${getAssignmentNumber(assignment.id, data.assignments)} ${equipment?.assetNo ?? ""} ${equipment?.equipmentName ?? ""} ${operator?.name ?? ""} ${project?.name ?? ""}`.toLowerCase();
}

function remoteTable(records: AssignmentRecord[], data: CanonicalAssignmentData, empty: string) {
  return <ResponsiveTable><div className="app-card min-w-max overflow-hidden"><table className="app-table min-w-full text-sm"><thead><tr>{["Assignment", "Equipment", "Operator", "Project", "Assigned", "Expected Return", "Completed / Returned", "Status", "Action"].map((label) => <th className="px-4 py-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{records.length === 0 ? <tr><td className="py-10 text-center text-slate-500" colSpan={9}>{empty}</td></tr> : records.map((assignment) => {
    const equipment = data.equipment.find((item) => item.id === assignment.equipmentId), operator = data.operators.find((item) => item.id === assignment.operatorId), project = data.projects.find((item) => item.id === assignment.projectId);
    const state = assignmentViewStatus(assignment);
    return <tr key={assignment.id} className="hover:bg-amber-50/60 dark:hover:bg-amber-950/20"><td className="px-4 py-3 font-semibold text-blue-600">{getAssignmentNumber(assignment.id, data.assignments)}</td><td className="px-4 py-3"><span className="block font-medium">{equipment?.equipmentName ?? "—"}</span><span className="block text-xs text-slate-500">{equipment?.assetNo ?? "—"}</span></td><td className="px-4 py-3">{operator?.name || "—"}</td><td className="px-4 py-3">{project?.name || "—"}</td><td className="px-4 py-3">{displayAssignmentDate(assignment.assignedDate)}</td><td className="px-4 py-3">{displayAssignmentExpectedReturn(assignment.expectedReturn)}</td><td className="px-4 py-3">{displayAssignmentDate(assignment.returnedDate)}</td><td className="px-4 py-3"><StatusBadge className={state === "Overdue" ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" : state === "Active" ? "bg-[#f0a93a] text-[#071a33]" : ""} tone={state === "Completed" ? "success" : "neutral"}>{state}</StatusBadge></td><td className="px-4 py-3"><Link aria-label={`View ${getAssignmentNumber(assignment.id, data.assignments)}`} className="inline-flex rounded p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800" to={`/assignments/${assignment.id}`}><ChevronRight size={17} aria-hidden="true" /></Link></td></tr>;
  })}</tbody></table></div></ResponsiveTable>;
}

type AssignmentView = "timeline" | "kanban" | "calendar" | "list";

function assignmentViewStatus(assignment: AssignmentRecord): "Active" | "Overdue" | "Completed" | "Cancelled" {
  if (assignment.status === "Completed" || assignment.status === "Cancelled") return assignment.status;
  const expected = assignment.expectedReturn && !assignment.expectedReturn.startsWith("1970-01-01") ? assignment.expectedReturn.slice(0, 10) : "";
  const today = new Date().toISOString().slice(0, 10);
  return expected && expected < today && !assignment.returnedDate ? "Overdue" : "Active";
}

function AssignmentToolbar({ view, setView }: { view: AssignmentView; setView: (view: AssignmentView) => void }) {
  const options: Array<[AssignmentView, string, typeof Rows3]> = [["timeline", "Timeline", Rows3], ["kanban", "Kanban", Columns3], ["calendar", "Calendar", CalendarDays], ["list", "List", List]];
  return <div className="app-card flex flex-wrap items-center justify-between gap-3 p-3"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">View</span><div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">{options.map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${view === key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}><Icon size={15} aria-hidden="true" />{label}</button>)}</div></div>;
}

function AssignmentBoard({ records, data, view }: { records: AssignmentRecord[]; data: CanonicalAssignmentData; view: Exclude<AssignmentView, "list"> }) {
  return <div className={`grid gap-3 ${view === "kanban" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>{records.length === 0 ? <div className="app-card p-6 text-sm text-slate-500">No current Bookings.</div> : records.map((assignment) => { const equipment = data.equipment.find((item) => item.id === assignment.equipmentId); const operator = data.operators.find((item) => item.id === assignment.operatorId); const project = data.projects.find((item) => item.id === assignment.projectId); const state = assignmentViewStatus(assignment); return <article key={assignment.id} className="app-card space-y-2 p-4"><div className="flex items-start justify-between gap-3"><h3 className="font-display font-semibold">{getAssignmentNumber(assignment.id, data.assignments)}</h3><StatusBadge tone={state === "Completed" ? "success" : "neutral"} className={state === "Overdue" ? "bg-rose-100 text-rose-800" : state === "Active" ? "bg-[#f0a93a] text-[#071a33]" : ""}>{state}</StatusBadge></div><p className="font-medium">{equipment?.equipmentName ?? "—"}</p><p className="text-sm text-slate-500">{operator?.name ?? "—"} · {project?.name ?? "—"}</p><p className="text-xs text-slate-500">{displayAssignmentDate(assignment.assignedDate)} → {displayAssignmentExpectedReturn(assignment.expectedReturn)}</p></article>; })}</div>;
}

function LocalAssignments() {
  const { assignments } = useAssignment();
  const { getEquipment } = useEquipment();
  const { operators } = useOperator();
  const { projects } = useProject();
  const [query, setQuery] = useState("");
  const current = assignments.filter((item) => item.status === "Active");
  const history = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assignments.filter((item) => item.status !== "Active").filter((item) => {
      const equipment = getEquipment(item.equipmentId), operator = operators.find((record) => record.id === item.operatorId), project = projects.find((record) => record.id === item.projectId);
      return `${getAssignmentNumber(item.id, assignments)} ${equipment?.assetNo ?? ""} ${equipment?.equipmentName ?? ""} ${operator?.name ?? ""} ${project?.projectName ?? ""}`.toLowerCase().includes(normalized);
    });
  }, [assignments, getEquipment, operators, projects, query]);
  const table = (records: AssignmentRecord[], empty: string) => <ResponsiveTable><div className="app-card min-w-max overflow-hidden"><table className="app-table min-w-full text-sm"><thead><tr>{["Assignment", "Equipment", "Operator", "Project", "Assigned", "Expected Return", "Completed / Returned", "Status", "Action"].map((label) => <th className="px-4 py-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{records.length === 0 ? <tr><td className="py-10 text-center text-slate-500" colSpan={9}>{empty}</td></tr> : records.map((assignment) => {
    const equipment = getEquipment(assignment.equipmentId), operator = operators.find((item) => item.id === assignment.operatorId), project = projects.find((item) => item.id === assignment.projectId);
    const state = assignmentViewStatus(assignment); return <tr key={assignment.id} className="hover:bg-amber-50/60 dark:hover:bg-amber-950/20"><td className="px-4 py-3 font-semibold text-blue-600">{getAssignmentNumber(assignment.id, assignments)}</td><td className="px-4 py-3"><span className="block font-medium">{equipment?.equipmentName ?? "—"}</span><span className="block text-xs text-slate-500">{equipment?.assetNo ?? "—"}</span></td><td className="px-4 py-3">{operator?.name ?? "—"}</td><td className="px-4 py-3">{project?.projectName ?? "—"}</td><td className="px-4 py-3">{displayAssignmentDate(assignment.assignedDate)}</td><td className="px-4 py-3">{displayAssignmentExpectedReturn(assignment.expectedReturn)}</td><td className="px-4 py-3">{displayAssignmentDate(assignment.returnedDate)}</td><td className="px-4 py-3"><StatusBadge tone={state === "Completed" ? "success" : "neutral"} className={state === "Overdue" ? "bg-rose-100 text-rose-800" : state === "Active" ? "bg-[#f0a93a] text-[#071a33]" : ""}>{state}</StatusBadge></td><td className="px-4 py-3"><Link aria-label={`View ${getAssignmentNumber(assignment.id, assignments)}`} className="inline-flex rounded p-1 text-blue-600 hover:bg-blue-50" to={`/assignments/${assignment.id}`}><ChevronRight size={17} aria-hidden="true" /></Link></td></tr>;
  })}</tbody></table></div></ResponsiveTable>;
  return <div className="app-page"><PageHeader title="Bookings" description="Coordinate equipment, operators, and projects across every booking." actions={<Link to="/assignments/new"><Button className="bg-[#f0a93a] text-[#071a33] hover:bg-[#d99a2f]">New Booking</Button></Link>} /><section className="space-y-3"><h2 className="font-display text-lg font-semibold">Current Bookings ({current.length})</h2>{table(current, "No current Bookings.")}</section><section className="space-y-3"><div><h2 className="font-display text-lg font-semibold">Completed / History ({history.length})</h2><p className="text-sm text-slate-500">Completed and cancelled records remain available for audit.</p></div><FilterBar onClear={() => setQuery("")} canClear={Boolean(query)}><label className="min-w-[16rem] flex-1 text-xs font-medium text-slate-600"><span className="block">Search history</span><input aria-label="Search completed assignments" className="app-control mt-1 w-full" onChange={(event) => setQuery(event.target.value)} placeholder="Assignment, equipment, operator, or project" value={query} /></label></FilterBar>{table(history, "No completed or cancelled Bookings match.")}</section></div>;
}
