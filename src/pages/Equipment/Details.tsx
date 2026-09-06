import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";

import { useEquipment } from "@/features/equipment/context/EquipmentContext";
import { useProject } from "@/features/project/context/ProjectContext";
import { useOperator } from "@/features/operators/context/OperatorContext";
import { useAssignment } from "@/features/assignment/context/AssignmentContext";
import { useRental } from "@/features/rental/context/RentalContext";
import { useMaintenance } from "@/features/maintenance/context/MaintenanceContext";
import { useDailyLog } from "@/features/daily-log";

import EquipmentTimeline from "@/features/equipment/history/components/EquipmentTimeline";
import { useCostCodes } from "@/features/masters/cost-code/context/useCostCodes";
import { getEquipmentCostCodeDisplay } from "@/features/equipment/utils/equipmentCostCode";
import { presentEquipmentStatus } from "@/features/equipment/utils/equipmentStatusPresentation";
import { validateEquipmentAssignment } from "@/features/assignment/utils/assignmentValidation";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseCanonicalRemoteRentalMutations, canUseLegacyRentalMutations } from "@/features/rental/services/rentalRuntimeCapability";
import { useAuth } from "@/features/auth/AuthContext";
import { getEquipmentRuntimeCapability } from "@/features/equipment/services/equipmentRuntimeCapability";
import { useCanonicalEquipmentData } from "@/features/equipment/hooks/useCanonicalEquipmentData";
import { useCanonicalEquipmentDetail, type RecentDeurActivityRecord } from "@/features/equipment/hooks/useCanonicalEquipmentDetail";
import type { CanonicalMaintenanceRecord } from "@/features/maintenance/canonical";
import CanonicalEquipmentHistory from "@/features/equipment/history/components/CanonicalEquipmentHistory";

export default function EquipmentDetails() {
  const { configuration } = useApplicationDependenciesCompatibility();
  return getEquipmentRuntimeCapability(configuration).canonicalReads ? <CanonicalEquipmentDetails /> : <LocalEquipmentDetails />;
}

export function LegacyCanonicalEquipmentDetails() {
  const { id } = useParams();
  const data = useCanonicalEquipmentData();
  const { readRepositories } = useApplicationDependenciesCompatibility();
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  useEffect(() => { let active = true; void Promise.resolve(readRepositories.equipmentCategories.list()).then((result) => { if (active && result.success) setCategoryNames(new Map(result.value.items.map((item) => [item.id, item.name]))); }); return () => { active = false; }; }, [readRepositories.equipmentCategories]);
  if (data.status === "loading") return <div className="p-8 text-slate-500">Loading canonical Equipment…</div>;
  if (data.status === "error") return <div className="p-8" role="alert">{data.message}<button className="ml-3 underline" onClick={data.retry}>Retry</button></div>;
  const equipment = data.items.find((item) => item.id === id && !item.deleted);
  if (!equipment) return <div className="p-8">Equipment not found.</div>;
  return <div className="space-y-6 p-8"><div><h1 className="text-3xl font-bold">{equipment.equipmentName}</h1><p className="mt-1 text-slate-500">Asset No. {equipment.assetNo}</p></div><div className="grid gap-4 md:grid-cols-3"><div className="app-card p-5"><p className="text-sm text-slate-500">Canonical Status</p><strong className="mt-2 block text-2xl">{equipment.statusLabel ?? "Unavailable"}</strong></div><div className="app-card p-5"><p className="text-sm text-slate-500">Active</p><strong className="mt-2 block text-2xl">{equipment.active ? "Yes" : "No"}</strong></div><div className="app-card p-5"><p className="text-sm text-slate-500">Current Reading</p><strong className="mt-2 block text-2xl">{equipment.currentReading ?? "—"}</strong></div></div><section className="app-card p-6"><h2 className="text-xl font-semibold">Canonical Equipment Information</h2><dl className="mt-4 grid gap-3 md:grid-cols-2"><div><dt className="text-sm text-slate-500">Category</dt><dd>{equipment.categoryId ? categoryNames.get(equipment.categoryId) ?? "Equipment Category" : "—"}</dd></div><div><dt className="text-sm text-slate-500">Sub-Category</dt><dd>{equipment.subcategoryName ? <>{equipment.subcategoryName}{equipment.subcategoryActive === false && <span className="ml-2 text-sm text-amber-700">— Inactive</span>}</> : "—"}</dd></div><div><dt className="text-sm text-slate-500">Manufacturer</dt><dd>{equipment.manufacturer ?? "—"}</dd></div><div><dt className="text-sm text-slate-500">Model</dt><dd>{equipment.model ?? "—"}</dd></div><div><dt className="text-sm text-slate-500">Serial Number</dt><dd>{equipment.serialNumber ?? "—"}</dd></div><div><dt className="text-sm text-slate-500">Maintenance Tracking</dt><dd>{equipment.maintenanceType ?? "—"}</dd></div></dl></section><p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Remote Equipment sub-category edit is pending a canonical Equipment update command. Assignment, Rental, maintenance, daily-log, history, edit, and deletion panels remain unavailable until their canonical boundaries are certified.</p><Link className="text-blue-600 underline" to="/equipment">Back to Equipment</Link></div>;
}

function MaintenanceRecordSummary({ record, label, display }: { record: CanonicalMaintenanceRecord; label: "Open" | "Completed"; display: (value: unknown) => string }) {
  return <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{label} maintenance</p><StatusBadge tone={record.status === "In Progress" ? "warning" : record.status === "Completed" ? "success" : "neutral"}>{record.status}</StatusBadge></div><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs text-slate-500">Maintenance Type</dt><dd className="mt-1 font-medium">{display(record.maintenanceType)}</dd></div><div><dt className="text-xs text-slate-500">{label === "Completed" ? "Completed Date" : "Scheduled Date"}</dt><dd className="mt-1 font-medium">{display(label === "Completed" ? record.completedDate : record.scheduledDate)}</dd></div><div><dt className="text-xs text-slate-500">Technician</dt><dd className="mt-1 font-medium">{display(record.technician)}</dd></div>{label === "Open" && <><div><dt className="text-xs text-slate-500">Scheduled Reading</dt><dd className="mt-1 font-medium">{display(record.scheduledReading)}</dd></div><div><dt className="text-xs text-slate-500">Current Reading</dt><dd className="mt-1 font-medium">{display(record.currentReading)}</dd></div></>}<div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-slate-500">Remarks</dt><dd className="mt-1 break-words text-sm">{display(record.remarks)}</dd></div></dl></div>;
}

function RecentDeurActivity({ item, display }: { item: RecentDeurActivityRecord; display: (value: unknown) => string }) {
  const { record, operatorName, projectName } = item;
  return <article className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{display(record.deurNumber)}</p><p className="mt-1 text-xs text-slate-500">Work Date {display(record.workDate)}</p></div><StatusBadge tone={record.status === "Submitted" || record.status === "Acknowledged" ? "success" : record.status === "Rejected" ? "danger" : "neutral"}>{record.status}</StatusBadge></div><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs text-slate-500">Operator</dt><dd className="mt-1 break-words font-medium">{display(operatorName)}</dd></div><div><dt className="text-xs text-slate-500">Project</dt><dd className="mt-1 break-words font-medium">{display(projectName)}</dd></div><div><dt className="text-xs text-slate-500">Operating</dt><dd className="mt-1 font-medium">{display(record.totalOperatingMinutes)} min</dd></div><div><dt className="text-xs text-slate-500">Idle</dt><dd className="mt-1 font-medium">{display(record.totalIdleMinutes)} min</dd></div><div><dt className="text-xs text-slate-500">Standby</dt><dd className="mt-1 font-medium">{display(record.totalStandbyMinutes)} min</dd></div><div><dt className="text-xs text-slate-500">Meal Break</dt><dd className="mt-1 font-medium">{display(record.totalMealBreakMinutes)} min</dd></div><div><dt className="text-xs text-slate-500">Breakdown</dt><dd className="mt-1 font-medium">{display(record.totalMaintenanceMinutes)} min</dd></div>{record.submittedAt && <div><dt className="text-xs text-slate-500">Submitted</dt><dd className="mt-1 break-words font-medium">{display(record.submittedAt)}</dd></div>}</dl></article>;
}

function CanonicalEquipmentDetails() {
  const { id } = useParams();
  const detail = useCanonicalEquipmentDetail(id);
  const { hasPermission } = useAuth();
  const { readRepositories } = useApplicationDependenciesCompatibility();
  const identity = detail.equipment.status === "ready" ? detail.equipment.value : undefined;
  if (detail.equipment.status === "loading") return <main className="app-page" aria-busy="true"><p role="status">Loading Equipment…</p></main>;
  if (detail.equipment.status === "error") return <main className="app-page"><p role="alert">Equipment could not be loaded.</p><Button variant="secondary" onClick={detail.retry}>Retry</Button></main>;
  if (!identity) return <main className="app-page"><p>Equipment not found.</p><Link className="text-blue-600 underline" to="/equipment">Back to Equipment</Link></main>;
  const display = (value: unknown) => typeof value === "string" && value.trim() ? value : value === 0 ? "0" : "—";
  const assignment = detail.assignment.status === "ready" ? detail.assignment.value : undefined;
  const rental = detail.rental.status === "ready" ? detail.rental.value : undefined;
  const maintenance = detail.maintenance.status === "ready" ? detail.maintenance.value : undefined;
  const recentDeurs = detail.recentDeurs.status === "ready" ? detail.recentDeurs.value : undefined;
  return <main className="app-page space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-slate-500">Equipment</p><h1 className="text-3xl font-bold">{identity.equipmentName}</h1><p className="mt-1 text-slate-500">Asset No. {identity.assetNo}</p></div><div className="flex items-center gap-3"><StatusBadge tone="neutral">{display(identity.statusLabel)}</StatusBadge><Link className="text-blue-600 underline" to="/equipment">Back to Equipment</Link></div></header>
     <section className="app-card p-5"><h2 className="text-lg font-semibold">Identification</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Category", identity.category],["Sub-Category", identity.subcategoryName],["Manufacturer", identity.manufacturer],["Model", identity.model],["Year", identity.yearModel],["Serial Number", identity.serialNumber],["Engine Number", identity.engineNumber],["Chassis Number", identity.chassisNumber],["Plate Number", identity.plateNumber]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium">{display(value)}</dd></div>)}</dl></section>
     <section className="app-card p-5"><h2 className="text-lg font-semibold">Operating Data</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Capacity</dt><dd className="mt-1 font-medium">{display(identity.capacity)}</dd></div><div><dt className="text-xs text-slate-500">Maintenance Tracking</dt><dd className="mt-1 font-medium">{display(identity.maintenanceType)}</dd></div><div><dt className="text-xs text-slate-500">Current Reading</dt><dd className="mt-1 font-medium">{display(identity.currentReading)}</dd></div></dl></section>
    {hasPermission("assignment.read") && <section className="app-card p-5"><h2 className="text-lg font-semibold">Current Assignment</h2>{detail.assignment.status === "loading" ? <p role="status" className="mt-3 text-sm text-slate-500">Loading assignment…</p> : detail.assignment.status === "error" ? <div className="mt-3"><p role="alert" className="text-sm text-red-700">Assignment details could not be loaded.</p><Button className="mt-2" size="sm" variant="secondary" onClick={detail.retry}>Retry</Button></div> : !assignment?.assignment ? <p className="mt-3 text-sm text-slate-500">Not currently assigned</p> : <dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1 font-medium">{assignment.assignment.status}</dd></div>{assignment.projectReadable && <div><dt className="text-xs text-slate-500">Project</dt><dd className="mt-1 font-medium">{display(assignment.project?.projectName)}</dd></div>}{assignment.operatorReadable && <div><dt className="text-xs text-slate-500">Operator</dt><dd className="mt-1 font-medium">{display(assignment.operator?.name)}</dd></div>}<div><dt className="text-xs text-slate-500">Assigned Date</dt><dd className="mt-1 font-medium">{display(assignment.assignment.assignedDate)}</dd></div></dl>}</section>}
    {hasPermission("rental.read") && <section className="app-card p-5"><h2 className="text-lg font-semibold">Current Rental</h2>{detail.rental.status === "loading" ? <p role="status" className="mt-3 text-sm text-slate-500">Loading rental…</p> : detail.rental.status === "error" ? <div className="mt-3"><p role="alert" className="text-sm text-red-700">Rental details could not be loaded.</p><Button className="mt-2" size="sm" variant="secondary" onClick={detail.retry}>Retry</Button></div> : !rental?.rental ? <p className="mt-3 text-sm text-slate-500">No current rental</p> : <dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Rental Number</dt><dd className="mt-1 font-medium">{display(rental.rental.rentalNumber)}</dd></div><div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1 font-medium">{rental.rental.status}</dd></div>{rental.customerReadable && <div><dt className="text-xs text-slate-500">Customer</dt><dd className="mt-1 font-medium">{display(rental.customer?.companyName ?? (rental.rental.customerId ? undefined : "No current customer"))}</dd></div>}<div><dt className="text-xs text-slate-500">Start Date</dt><dd className="mt-1 font-medium">{display(rental.rental.dateOut)}</dd></div></dl>}</section>}
    {hasPermission("maintenance.read") && <section className="app-card p-5"><h2 className="text-lg font-semibold">Maintenance Snapshot</h2>{detail.maintenance.status === "loading" ? <p role="status" className="mt-3 text-sm text-slate-500">Loading maintenance…</p> : detail.maintenance.status === "error" ? <div className="mt-3"><p role="alert" className="text-sm text-red-700">Maintenance details could not be loaded.</p><Button className="mt-2" size="sm" variant="secondary" onClick={detail.retry}>Retry</Button></div> : <div className="mt-4 space-y-4">{maintenance?.openRecords.length ? <><MaintenanceRecordSummary record={maintenance.openRecords[0]} label="Open" display={display} />{maintenance.openRecords.length > 1 && <p className="text-sm text-slate-500">{maintenance.openRecords.length} open maintenance records</p>}</> : <p className="text-sm text-slate-500">No open maintenance</p>}{maintenance?.latestCompleted ? <MaintenanceRecordSummary record={maintenance.latestCompleted} label="Completed" display={display} /> : <p className="text-sm text-slate-500">No completed maintenance record</p>}</div>}</section>}
    {hasPermission("deur.read") && <section className="app-card p-5"><h2 className="text-lg font-semibold">Recent DEUR Activity</h2>{detail.recentDeurs.status === "loading" ? <p role="status" className="mt-3 text-sm text-slate-500">Loading recent DEUR activity…</p> : detail.recentDeurs.status === "error" ? <div className="mt-3"><p role="alert" className="text-sm text-red-700">Recent DEUR activity could not be loaded.</p><Button className="mt-2" size="sm" variant="secondary" onClick={detail.retry}>Retry</Button></div> : recentDeurs?.length ? <div className="mt-4 space-y-3">{recentDeurs.map((item) => <RecentDeurActivity key={item.record.id} item={item} display={display} />)}</div> : <p className="mt-3 text-sm text-slate-500">No recent DEUR activity</p>}</section>}
    <CanonicalEquipmentHistory equipmentId={identity.id} rental={readRepositories.rentalLifecycleHistory} summary={readRepositories.lifecycleSummary} permissions={{ rental: hasPermission("rental.read"), maintenance: hasPermission("maintenance.read"), deur: hasPermission("deur.read") }} />
  </main>;
}

function LocalEquipmentDetails() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const rentalCreationAvailable = canUseLegacyRentalMutations(configuration)
    || (canUseCanonicalRemoteRentalMutations(configuration) && Boolean(commandRepositories.canonicalRental) && hasPermission("rental.create"));
  const { id } = useParams();

  const { getEquipment } =
    useEquipment();

  const equipment =
    id
      ? getEquipment(id)
      : undefined;

  const { projects } =
    useProject();

  const { operators } =
    useOperator();

  const {
    assignments,
    activeAssignments,
  } = useAssignment();

  const { rentals } =
    useRental();

  const { maintenance } =
    useMaintenance();

  const { logs } =
    useDailyLog();

  const { costCodes } = useCostCodes();

  if (!equipment) {
    return (
      <div className="p-8">
        Equipment not found.
      </div>
    );
  }

  const project =
    projects.find(
      (p) =>
        p.id ===
        equipment.projectId
    );

  const operator =
    operators.find(
      (o) =>
        o.id ===
        equipment.operatorId
    );

  const currentAssignment =
    activeAssignments.find(
      (a) =>
        a.equipmentId ===
        equipment.id
    );

  const activeRental =
    rentals.find(
      (r) =>
        r.equipmentId ===
          equipment.id &&
        r.status ===
          "Active"
    );

  const equipmentLogs =
    logs.filter(
      (l) =>
        l.equipmentId ===
        equipment.id
    );

  const maintenanceHistory =
    maintenance.filter(
      (m) =>
        m.equipmentId ===
        equipment.id
    );

  const assignmentHistory =
    assignments.filter(
      (a) =>
        a.equipmentId ===
        equipment.id
    );

  const rentalHistory =
    rentals.filter(
      (r) =>
        r.equipmentId ===
        equipment.id
    );

  const totalWorkingHours =
    equipmentLogs.reduce(
      (sum, log) =>
        sum +
        log.workingHours,
      0
    );

  const totalAssignments =
    assignmentHistory.length;

  const totalRentals =
    rentalHistory.length;

  const totalMaintenance =
    maintenanceHistory.length;

  const costCode = getEquipmentCostCodeDisplay(
    equipment.costCodeId,
    costCodes,
  );
  const assignmentEligibility = validateEquipmentAssignment(equipment);

  return (
    <div className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold">
            {equipment.equipmentName}
          </h1>

          <div className="grid grid-cols-2 gap-4">

  <div>

    <div className="text-xs text-slate-500">
      Manufacturer
    </div>

    <div className="font-medium">
      {equipment.manufacturer || "-"}
    </div>

  </div>

  <div>

    <div className="text-xs text-slate-500">
      Model
    </div>

    <div className="font-medium">
      {equipment.model || "-"}
    </div>

  </div>

</div>

<div className="grid grid-cols-2 gap-4">

  <div>

  <div className="grid grid-cols-2 gap-4">

<div>
  <div className="text-xs text-slate-500">
    Serial Number
  </div>

  <div className="font-medium">
    {equipment.serialNumber || "-"}
  </div>
</div>

<div>
  <div className="text-xs text-slate-500">
    Plate Number
  </div>

  <div className="font-medium">
    {equipment.plateNumber || "-"}
  </div>
</div>

</div>

<div className="grid grid-cols-2 gap-4">

<div>
  <div className="text-xs text-slate-500">
    Engine Number
  </div>

  <div className="font-medium">
    {equipment.engineNumber || "-"}
  </div>
</div>

<div>
  <div className="text-xs text-slate-500">
    Chassis Number
  </div>

  <div className="font-medium">
    {equipment.chassisNumber || "-"}
  </div>
</div>

</div>

    <div className="text-xs text-slate-500">
      Year Model
    </div>

    <div className="font-medium">
      {equipment.yearModel ?? "-"}
    </div>

  </div>

  <div>

    <div className="text-xs text-slate-500">
      Capacity
    </div>

    <div className="font-medium">
      {equipment.capacity || "-"}
    </div>

  </div>

</div>

          <p className="mt-1 text-gray-500">
            Asset No.
            {" "}
            {equipment.assetNo}
          </p>

        </div>

        <div className="flex flex-wrap gap-2">

          {assignmentEligibility.valid ? <Link to={`/assignments/new?equipment=${equipment.id}`}><Button>Assign</Button></Link> : <span title={assignmentEligibility.message}><Button disabled>Assign</Button></span>}

          {rentalCreationAvailable && <Link
            to={`/rentals/new?equipment=${equipment.id}`}
          >
            <Button>
              Rent
            </Button>
          </Link>}

          <Link
            to={`/maintenance/new?equipment=${equipment.id}`}
          >
            <Button>
              Maintenance
            </Button>
          </Link>

          <Link
            to={`/daily-logs/new?equipment=${equipment.id}`}
          >
            <Button>
              Daily Log
            </Button>
          </Link>

        </div>

      </div>

      <div className="grid gap-4 md:grid-cols-4">

        <div className="rounded-xl border bg-white p-5">

          <div className="text-sm text-gray-500">
            Status
          </div>

          <div className="mt-2 text-2xl font-bold">
            {presentEquipmentStatus(equipment.status)}
          </div>

        </div>

        <div className="rounded-xl border bg-white p-5">

          <div className="text-sm text-gray-500">
            Current Reading
          </div>

          <div className="mt-2 text-2xl font-bold">
            {equipment.currentReading}
          </div>

        </div>

        <div className="rounded-xl border bg-white p-5">

          <div className="text-sm text-gray-500">
            Total Usage
          </div>

          <div className="mt-2 text-2xl font-bold">
            {totalWorkingHours}
          </div>

        </div>

        <div className="rounded-xl border bg-white p-5">

          <div className="text-sm text-gray-500">
            Daily Logs
          </div>

          <div className="mt-2 text-2xl font-bold">
            {equipmentLogs.length}
          </div>

        </div>

      </div>

      <div className="grid gap-6 lg:grid-cols-2">

        <div className="rounded-xl border bg-white p-6">

          <h2 className="mb-4 text-xl font-semibold">
            Equipment Information
          </h2>

          <div className="space-y-3">

            <div>

              <strong>
                Cost Code:
              </strong>
              {costCode.configured ? (
                <div className="mt-1">
                  <div className="font-medium">{costCode.code}</div>
                  <div className="text-sm text-slate-500">{costCode.name}</div>
                </div>
              ) : (
                <div className="mt-1 text-amber-700">{costCode.warning}</div>
              )}

            </div>

            <div>

              <strong>
                Project:
              </strong>
              {" "}
              {project?.projectName ??
                "-"}

            </div>

            <div>

              <strong>
                Operator:
              </strong>
              {" "}
              {operator?.name ??
                "-"}

            </div>

            <div>

              <strong>
                Tracking:
              </strong>
              {" "}
              {
                equipment.maintenanceType
              }

            </div>

            <div>

              <strong>
                Current Assignment:
              </strong>
              {" "}

              {currentAssignment
                ? "Active"
                : "None"}

            </div>

            <div>

              <strong>
                Current Rental:
              </strong>
              {" "}

              {activeRental
                ? "Active"
                : "Available"}

            </div>

          </div>

        </div>

        <div className="rounded-xl border bg-white p-6">

          <h2 className="mb-4 text-xl font-semibold">
            Fleet Statistics
          </h2>

          <div className="space-y-3">

            <div>

              Total Assignments:
              {" "}
              {totalAssignments}

            </div>

            <div>

              Total Rentals:
              {" "}
              {totalRentals}

            </div>

            <div>

              Maintenance Records:
              {" "}
              {totalMaintenance}

            </div>

            <div>

              Daily Logs:
              {" "}
              {equipmentLogs.length}

            </div>

          </div>

        </div>

      </div>

      <div className="rounded-xl border bg-white p-6">

        <h2 className="mb-4 text-xl font-semibold">
          Maintenance Status
        </h2>

        {maintenanceHistory.length ===
        0 ? (

          <div className="rounded bg-yellow-100 p-4">

            No maintenance history.

          </div>

        ) : (

          <div className="space-y-2">

            <div>

              Latest Record:
              {" "}
              {
                maintenanceHistory[
                  maintenanceHistory.length -
                    1
                ].scheduledDate
              }

            </div>

            <div>

              Total Maintenance:
              {" "}
              {maintenanceHistory.length}

            </div>

          </div>

        )}

      </div>

      <div className="rounded-xl border bg-white p-6">

        <h2 className="mb-4 text-xl font-semibold">
          Recent Daily Logs
        </h2>

        {equipmentLogs.length ===
        0 ? (

          <div className="text-gray-500">

            No daily logs available.

          </div>

        ) : (

          <table className="min-w-full">

            <thead>

              <tr className="border-b">

                <th className="py-2 text-left">
                  Date
                </th>

                <th className="py-2 text-right">
                  Start
                </th>

                <th className="py-2 text-right">
                  End
                </th>

                <th className="py-2 text-right">
                  Hours
                </th>

              </tr>

            </thead>

            <tbody>

              {equipmentLogs
                .slice()
                .reverse()
                .slice(0, 5)
                .map((log) => (

                  <tr
                    key={log.id}
                    className="border-b"
                  >

                    <td className="py-2">
                      {log.date}
                    </td>

                    <td className="py-2 text-right">
                      {
                        log.startReading
                      }
                    </td>

                    <td className="py-2 text-right">
                      {log.endReading}
                    </td>

                    <td className="py-2 text-right">
                      {
                        log.workingHours
                      }
                    </td>

                  </tr>

                ))}

            </tbody>

          </table>

        )}

      </div>

      <div className="rounded-xl border bg-white p-6">

        <h2 className="mb-4 text-xl font-semibold">
          Equipment Timeline
        </h2>

        <EquipmentTimeline
          equipmentId={
            equipment.id
          }
        />

      </div>

    </div>
  );
}
