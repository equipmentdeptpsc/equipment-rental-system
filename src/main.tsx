import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { router } from "@/app/router";
import AppErrorBoundary from "@/app/AppErrorBoundary";

import { AuthProvider } from "@/features/auth/AuthContext";

import { ToastProvider } from "@/components/ui/toast/ToastContext";

import { PrefixProvider } from "@/features/settings/context/PrefixContext";

import { AuditProvider } from "@/features/equipment/audit/AuditContext";

import MasterProviders from "@/app/MasterProviders";

import { EquipmentProvider } from "@/features/equipment/context/EquipmentContext";
import { EquipmentHistoryProvider } from "@/features/equipment/history";

import { DailyLogProvider } from "@/features/daily-log";

import { AssignmentProvider } from "@/features/assignment/context/AssignmentContext";
import { RentalProvider } from "@/features/rental/context/RentalContext";
import { MaintenanceProvider } from "@/features/maintenance/context/MaintenanceContext";

import { OperatorProvider } from "@/features/operators/context/OperatorContext";
import { CustomerProvider } from "@/features/customer/context/CustomerContext";
import { ProjectProvider } from "@/features/project/context/ProjectContext";
import { createDeurSyncLifecycle } from "@/features/rental/deur/synchronization/lifecycle/createDeurSyncLifecycle";
import { ApplicationDependencyProvider, resolveRuntimeEnvironment } from "@/app/composition";

import "./index.css";

function AppProviders() {
  return (
    <AuthProvider>

      <ToastProvider>

        <PrefixProvider>

          <AuditProvider>

            <MasterProviders>

              <EquipmentProvider>

                <EquipmentHistoryProvider>

                  <DailyLogProvider>

                    <OperatorProvider>

                      <CustomerProvider>

                        <ProjectProvider>

                          <AssignmentProvider>

                            <RentalProvider>

                              <MaintenanceProvider>

                                {/** Application Routes */}
                                <RouterProvider router={router} />

                              </MaintenanceProvider>

                            </RentalProvider>

                          </AssignmentProvider>

                        </ProjectProvider>

                      </CustomerProvider>

                    </OperatorProvider>

                  </DailyLogProvider>

                </EquipmentHistoryProvider>

              </EquipmentProvider>

            </MasterProviders>

          </AuditProvider>

        </PrefixProvider>

      </ToastProvider>

    </AuthProvider>
  );
}

const runtimeEnvironment = resolveRuntimeEnvironment({
  persistenceMode: import.meta.env.VITE_PERSISTENCE_MODE,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  hostname: window.location.hostname,
});

if (runtimeEnvironment.kind !== "configuration-error") {
  const deurSyncLifecycle = createDeurSyncLifecycle();
  void deurSyncLifecycle.start();
  if (import.meta.hot) import.meta.hot.dispose(() => deurSyncLifecycle.stop());
}

function RuntimeConfigurationError() {
  return <main className="grid min-h-[100dvh] place-items-center bg-slate-100 p-6 dark:bg-slate-950"><section className="max-w-lg rounded-xl bg-white p-6 text-center shadow dark:bg-slate-900"><h1 className="text-xl font-semibold">UAT configuration error</h1><p className="mt-3 text-slate-600 dark:text-slate-300">This deployment is not configured for remote authentication. Contact an administrator to correct the deployment configuration.</p></section></main>;
}


ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <AppErrorBoundary>{runtimeEnvironment.kind === "configuration-error" ? <RuntimeConfigurationError /> : <ApplicationDependencyProvider><AppProviders /></ApplicationDependencyProvider>}</AppErrorBoundary>
  </React.StrictMode>
);
