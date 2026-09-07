import { Link } from "react-router-dom";

import Button from "@/components/ui/Button";
import ResponsiveTable from "@/components/ui/ResponsiveTable";

import ProjectStats from "@/features/project/components/ProjectStats";
import { useProject } from "@/features/project/context/ProjectContext";
import { useCustomer } from "@/features/customer/context/CustomerContext";
import { getProjectCustomerLabel } from "@/features/project/services/projectCustomerService";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { useCanonicalProjectData } from "@/features/project/hooks/useCanonicalProjectData";
import { canLinkProjectCustomer, getProjectRuntimeCapability } from "@/features/project/services/projectRuntimeCapability";
import { useAuth } from "@/features/auth/AuthContext";

export default function ProjectPage() {
  const { configuration, commandRepositories } = useApplicationDependenciesCompatibility();
  const { hasPermission } = useAuth();
  const capability = getProjectRuntimeCapability(configuration, Boolean(commandRepositories.canonicalProject));
  const canLinkCustomers = canLinkProjectCustomer(configuration, typeof commandRepositories.canonicalProject?.updateProjectCustomer === "function") && hasPermission("project.update");
  return capability.canonicalReads ? <CanonicalProjectPage canCreate={capability.canonicalMutations && hasPermission("project.manage")} canLinkCustomers={canLinkCustomers} /> : <LocalProjectPage />;
}

function CanonicalProjectPage({ canCreate, canLinkCustomers }: { canCreate: boolean; canLinkCustomers: boolean }) {
  const data = useCanonicalProjectData();
  if (data.status === "loading") return <div className="p-8 text-slate-500">Loading canonical Projects…</div>;
  if (data.status === "error") return <div className="p-8" role="alert">{data.message}<button className="ml-3 underline" onClick={data.retry}>Retry</button></div>;
  const projects = data.items.filter((project) => !project.deleted);
  return <div className="space-y-8 p-8"><div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Projects</h1><p className="text-slate-500">Canonical company Projects.</p></div>{canCreate && <Link to="/projects/new"><Button>New Project</Button></Link>}</div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">Projects</p><h2 className="mt-2 text-3xl font-bold">{projects.length}</h2></div><div className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">Active</p><h2 className="mt-2 text-3xl font-bold">{projects.filter((project) => project.active).length}</h2></div></div>{!projects.length ? <div className="rounded-xl border bg-white p-8 text-center text-slate-500">No canonical Projects found.</div> : <ResponsiveTable><div className="min-w-max rounded-xl border bg-white"><table className="min-w-full"><thead className="bg-slate-100"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Project</th><th className="p-3 text-left">Location</th><th className="p-3 text-left">Status</th>{canLinkCustomers && <th className="p-3 text-left">Customer</th>}</tr></thead><tbody>{projects.map((project) => <tr className="border-t" key={project.id}><td className="p-3">{project.projectCode ?? "—"}</td><td className="p-3">{project.name}</td><td className="p-3">{project.location ?? "—"}</td><td className="p-3">{project.active ? "Active" : "Inactive"}</td>{canLinkCustomers && <td className="p-3">{project.customerId ? <Link className="text-blue-600 underline" to={`/projects/${project.id}/customer`}>View Customer</Link> : <Link className="text-blue-600 underline" to={`/projects/${project.id}/customer`}>Link Customer</Link>}</td>}</tr>)}</tbody></table></div></ResponsiveTable>}</div>;
}

function LocalProjectPage() {
  const { projects } = useProject();
  const { customers } = useCustomer();

  return (
    <div className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold">
            Projects
          </h1>

          <p className="text-slate-500">
            Project Master
          </p>

        </div>

        <Link to="/projects/new">
          <Button>
            New Project
          </Button>
        </Link>

      </div>

      <ProjectStats />

      <ResponsiveTable><div className="rounded-xl border bg-white min-w-max">

        <table className="min-w-full">

          <thead className="bg-slate-100">

            <tr>

              <th className="p-3 text-left">
                Code
              </th>

              <th className="p-3 text-left">
                Project
              </th>

              <th className="p-3 text-left">
                Client
              </th>

              <th className="p-3 text-left">
                Manager
              </th>

              <th className="p-3 text-left">
                Status
              </th>
              <th className="p-3 text-left">Action</th>

            </tr>

          </thead>

          <tbody>

            {projects.map((project) => (

              <tr
                key={project.id}
                className="border-t"
              >

                <td className="p-3">
                  {project.projectCode}
                </td>

                <td className="p-3">
                  {project.projectName}
                </td>

                <td className="p-3">
                  {getProjectCustomerLabel(project, customers)}
                </td>

                <td className="p-3">
                  {project.projectManager}
                </td>

                <td className="p-3">
                  {project.status}
                </td>
                <td className="p-3"><Link className="text-blue-600 underline" to={`/projects/${project.id}/edit`}>Edit</Link></td>

              </tr>

            ))}

          </tbody>

        </table>

      </div></ResponsiveTable>

    </div>
  );
}
