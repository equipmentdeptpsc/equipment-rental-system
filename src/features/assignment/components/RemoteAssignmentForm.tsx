import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { useFormSubmission } from "@/components/form/useFormSubmission";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { useCanonicalAssignmentData } from "@/features/assignment/hooks/useCanonicalAssignmentData";
import { requestCanonicalAssignmentRefresh } from "@/features/assignment/remote/canonicalAssignmentRefresh";
import type { CanonicalReferenceCode } from "@/features/rental/remote/contracts";

interface References { activityCodes: CanonicalReferenceCode[] }

export default function RemoteAssignmentForm() {
  const { commandRepositories } = useApplicationDependenciesCompatibility();
  const data = useCanonicalAssignmentData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [references, setReferences] = useState<{ status: "loading" | "loaded" | "error"; value: References }>({ status: "loading", value: { activityCodes: [] } });
  const [form, setForm] = useState({ equipmentId: searchParams.get("equipment") ?? "", operatorId: "", projectId: "", assignedDate: new Date().toISOString().split("T")[0], expectedReturn: "", activityCodeId: "", remarks: "" });
  const identity = useRef<{ assignmentId: string; commandId: string; idempotencyKey: string } | undefined>(undefined);
  const submission = useFormSubmission("Assignment", async () => {
    const command = identity.current ??= { assignmentId: crypto.randomUUID(), commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const result = await commandRepositories.canonicalAssignment!.createAssignment({ ...command, ...form, expectedReturn: form.expectedReturn || undefined, activityCodeId: form.activityCodeId || undefined });
    if (!result.success) throw new Error(result.message);
    requestCanonicalAssignmentRefresh();
    navigate(`/assignments/${result.value.id}`);
  });

  useEffect(() => {
    let active = true;
    void commandRepositories.canonicalRental?.readReferenceData().then((codes) => {
      if (!active) return;
      if (!codes?.success) return setReferences({ status: "error", value: { activityCodes: [] } });
      setReferences({ status: "loaded", value: { activityCodes: codes.value.activityCodes } });
    }).catch(() => { if (active) setReferences({ status: "error", value: { activityCodes: [] } }); });
    return () => { active = false; };
  }, [commandRepositories.canonicalRental]);

  const availableEquipment = useMemo(() => data.data.equipment.filter((item) => item.active && !item.deleted), [data.data.equipment]);
  const availableOperators = useMemo(() => data.data.operators.filter((item) => item.status === "Active" && !item.deleted && !data.data.assignments.some((assignment) => assignment.status === "Active" && assignment.operatorId === item.id)), [data.data.assignments, data.data.operators]);
  const activeProjects = data.data.projects.filter((item) => item.active);
  const update = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }));

  if (data.status === "loading" || references.status === "loading") return <div className="p-8 text-slate-500">Loading canonical Assignment form data…</div>;
  if (data.status === "error") return <div className="p-8" role="alert">{data.message}<button className="ml-3 underline" onClick={data.retry}>Retry</button></div>;
  if (references.status === "error") return <div className="p-8" role="alert">Canonical Assignment reference data could not be loaded. Refresh and try again.</div>;
  return <div className="mx-auto max-w-3xl space-y-6 p-8"><div><h1 className="text-3xl font-bold">New Assignment</h1><p className="mt-2 text-gray-500">Create a canonical remote Assignment.</p></div><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (!form.equipmentId || !form.operatorId || !form.projectId || !form.assignedDate || (form.expectedReturn && form.expectedReturn < form.assignedDate)) return submission.fail("Complete the required Assignment fields and enter valid dates."); void submission.submit(undefined); }}>{submission.feedback}<Select searchable clearable label="Equipment" value={form.equipmentId} onChange={(event) => update("equipmentId", event.target.value)} options={[{ label: "Select Equipment", value: "" }, ...availableEquipment.map((item) => ({ label: `${item.assetNo} - ${item.equipmentName}`, value: item.id }))]} /><Select searchable clearable label="Operator" value={form.operatorId} onChange={(event) => update("operatorId", event.target.value)} options={[{ label: "Select Operator", value: "" }, ...availableOperators.map((item) => ({ label: item.name, value: item.id }))]} /><Select searchable clearable label="Project" value={form.projectId} onChange={(event) => update("projectId", event.target.value)} options={[{ label: "Select Project", value: "" }, ...activeProjects.map((item) => ({ label: `${item.projectCode ? `${item.projectCode} - ` : ""}${item.name}`, value: item.id }))]} /><div className="grid gap-4 md:grid-cols-2"><Input label="Assigned / Start Date" type="date" required value={form.assignedDate} onChange={(event) => update("assignedDate", event.target.value)} /><Input label="Expected Return" type="date" min={form.assignedDate} value={form.expectedReturn} onChange={(event) => update("expectedReturn", event.target.value)} /></div><Select searchable clearable label="Activity Code" value={form.activityCodeId} onChange={(event) => update("activityCodeId", event.target.value)} options={[{ label: "Select Activity Code", value: "" }, ...references.value.activityCodes.filter((item) => item.active).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))]} /><Input label="Remarks" value={form.remarks} onChange={(event) => update("remarks", event.target.value)} /><div className="flex justify-end"><Button type="submit" disabled={submission.busy}>{submission.busy ? "Saving..." : "Create Assignment"}</Button></div></form></div>;
}
