import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useApplicationDependenciesCompatibility } from "@/app/composition";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useAuth } from "@/features/auth/AuthContext";
import type { CustomerRecord } from "@/features/customer/types";
import { requestCanonicalProjectRefresh } from "@/features/project/remote/canonicalProjectRefresh";
import { canLinkProjectCustomer } from "@/features/project/services/projectRuntimeCapability";
import type { ProjectRecord } from "@/features/project/types";

type ProjectState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; project: ProjectRecord };

type CustomerState =
  | { status: "idle" | "loading"; items: CustomerRecord[] }
  | { status: "error"; items: CustomerRecord[]; message: string }
  | { status: "loaded"; items: CustomerRecord[] };

export default function RemoteProjectCustomerLink() {
  const { id = "" } = useParams();
  const dependencies = useApplicationDependenciesCompatibility();
  const repository = dependencies.commandRepositories.canonicalProject;
  const { hasPermission } = useAuth();
  const [projectState, setProjectState] = useState<ProjectState>({ status: "loading" });
  const [customerState, setCustomerState] = useState<CustomerState>({ status: "idle", items: [] });
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const loadProject = useCallback(async () => {
    if (!id) {
      setProjectState({ status: "error", message: "Project not found." });
      return;
    }
    const result = await Promise.resolve(dependencies.readRepositories.projects.getById(id));
    if (!result.success || !result.value || result.value.deleted) {
      setProjectState({ status: "error", message: "Canonical Project could not be loaded." });
      return;
    }
    setProjectState({ status: "loaded", project: result.value });
  }, [dependencies.readRepositories.projects, id]);

  useEffect(() => { void loadProject(); }, [loadProject]);

  const project = projectState.status === "loaded" ? projectState.project : undefined;
  const allowed = hasPermission("project.update");
  const capability = canLinkProjectCustomer(dependencies.configuration, typeof repository?.updateProjectCustomer === "function");
  const canLink = Boolean(project && !project.customerId && typeof project.rowVersion === "number" && capability && allowed);

  useEffect(() => {
    let active = true;
    setCustomerState({ status: "idle", items: [] });
    if (!project) return () => { active = false; };
    const operation = project.customerId
      ? dependencies.readRepositories.customers.getById(project.customerId)
      : canLink
        ? dependencies.readRepositories.customers.list({
            filters: { active: true, deleted_at: null },
            ordering: [{ field: "customer_code", ascending: true }],
            paging: { limit: 100, offset: 0 },
          })
        : undefined;
    if (!operation) return () => { active = false; };
    setCustomerState({ status: "loading", items: [] });
    void Promise.resolve(operation).then((result) => {
      if (!active) return;
      if (!result.success) {
        setCustomerState({ status: "error", items: [], message: "Canonical Customer data could not be loaded." });
        return;
      }
      const resultValue = result.value;
      const value = resultValue && typeof resultValue === "object" && "items" in resultValue
        ? resultValue.items as CustomerRecord[]
        : resultValue ? [resultValue as CustomerRecord] : [];
      setCustomerState({ status: "loaded", items: project.customerId ? value : value.filter((customer) => customer.active) });
    }).catch(() => {
      if (active) setCustomerState({ status: "error", items: [], message: "Canonical Customer data could not be loaded." });
    });
    return () => { active = false; };
  }, [canLink, dependencies.readRepositories.customers, project]);

  async function submit() {
    if (!canLink || !project || !selectedCustomerId || !repository?.updateProjectCustomer || working.current) return;
    const customer = customerState.items.find((item) => item.id === selectedCustomerId);
    if (!customer) {
      setMessage({ kind: "error", text: "Select an active canonical Customer." });
      return;
    }
    if (!window.confirm(`Link ${project.projectName} to ${customer.customerCode} — ${customer.companyName}? This relationship cannot be changed from the Project UI.`)) return;
    working.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const commandId = crypto.randomUUID();
      const result = await repository.updateProjectCustomer({
        commandId,
        idempotencyKey: commandId,
        projectId: project.id,
        customerId: customer.id,
        expectedVersion: project.rowVersion!,
      });
      if (!result.success) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      await loadProject();
      requestCanonicalProjectRefresh();
      setMessage({ kind: "success", text: "Customer linked to Project." });
    } catch {
      setMessage({ kind: "error", text: "The Project Customer link could not be confirmed. Refresh before retrying." });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (projectState.status === "loading") return <div className="p-8 text-slate-500">Loading canonical Project…</div>;
  if (projectState.status === "error") return <div className="p-8" role="alert">{projectState.message}<button className="ml-3 underline" onClick={() => { setProjectState({ status: "loading" }); void loadProject(); }}>Retry</button></div>;

  const currentProject = projectState.project;
  const linkedCustomer = currentProject.customerId ? customerState.items.find((item) => item.id === currentProject.customerId) : undefined;
  const customerOptions = [
    { value: "", label: "Select Customer" },
    ...customerState.items.map((customer) => ({ value: customer.id, label: `${customer.customerCode} — ${customer.companyName}` })),
  ];

  return <div className="mx-auto max-w-3xl space-y-6 p-8">
    <div><h1 className="text-3xl font-bold">Project Customer</h1><p className="mt-2 text-slate-500">Canonical remote Project relationship.</p></div>
    <section className="rounded-xl border bg-white p-6 shadow-sm">
      <dl className="grid gap-5 sm:grid-cols-2">
        <div><dt className="text-xs uppercase tracking-wide text-slate-500">Project</dt><dd className="mt-1 font-medium">{currentProject.projectCode} — {currentProject.projectName}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-slate-500">Customer</dt><dd className="mt-1 font-medium">{currentProject.customerId ? linkedCustomer ? `${linkedCustomer.customerCode} — ${linkedCustomer.companyName}` : customerState.status === "loading" ? "Loading canonical Customer…" : "Canonical Customer unavailable" : "Not linked"}</dd></div>
      </dl>
    </section>
    {message && <p className={`rounded border px-3 py-2 text-sm ${message.kind === "error" ? "border-red-300 bg-red-50 text-red-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    {canLink && <form className="space-y-4 rounded-xl border bg-white p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Select label="Customer" searchable value={selectedCustomerId} options={customerOptions} loading={customerState.status === "loading"} disabled={busy || customerState.status === "error"} helperText={customerState.status === "error" ? customerState.message : "Only active canonical Customers are available."} onChange={(event) => setSelectedCustomerId(event.target.value)} />
      <div className="flex flex-wrap justify-between gap-3"><Link to="/projects"><Button type="button" variant="secondary">Back to Projects</Button></Link><Button type="submit" disabled={!selectedCustomerId || busy || customerState.status !== "loaded"} loading={busy}>{busy ? "Linking…" : "Link Customer"}</Button></div>
    </form>}
    {!canLink && <div className="flex justify-end"><Link to="/projects"><Button variant="secondary">Back to Projects</Button></Link></div>}
  </div>;
}
