import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";

import AppLayout from "./AppLayout";
import type { Permission } from "@/features/auth/domain/permission";
import AnonymousRoute from "@/features/auth/guards/AnonymousRoute";
import RequireAuthentication from "@/features/auth/guards/RequireAuthentication";
import RequirePermission from "@/features/auth/guards/RequirePermission";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";
import AccessDenied from "@/pages/AccessDenied";
import Login from "@/pages/Login";
import Equipment from "@/pages/Equipment";
import NewEquipment from "@/pages/Equipment/New";
import EditEquipment from "@/pages/Equipment/Edit";
import EquipmentDetails from "@/pages/Equipment/Details";
import EquipmentTrash from "@/pages/Equipment/Trash";
import CustomerPage from "@/pages/Customers";
import NewCustomer from "@/pages/Customers/New";
import CustomerDetails from "@/pages/Customers/Details";
import EditCustomer from "@/pages/Customers/Edit";
import Operators from "@/pages/Operators";
import NewOperator from "@/pages/Operators/New";
import EditOperator from "@/pages/Operators/Edit";
import Projects from "@/pages/Projects";
import NewProject from "@/pages/Projects/New";
import EditProject from "@/pages/Projects/Edit";
import Assignments from "@/pages/Assignments";
import NewAssignment from "@/pages/Assignments/New";
import AssignmentDetails from "@/pages/Assignments/Details";
import EditAssignment from "@/pages/Assignments/Edit";
import RentalPage from "@/pages/Rental";
import NewRental from "@/pages/Rental/New";
import ReturnRental from "@/pages/Rental/Return";
import RentalWorkspacePage from "@/pages/RentalWorkspace";
import RentalCommercialTermsPage from "@/pages/Rental/CommercialTerms";
import RentalCustomerContactPage from "@/pages/Rental/CustomerContact";
import OperatorDeurPage from "@/pages/OperatorDeur";
import OperatorLandingPage from "@/pages/OperatorLanding";
import RentalApprovalPage from "@/pages/RentalApproval";
import CustomerDeurReviewPage from "@/pages/CustomerDeurReview";
import GroupedCustomerReviewPage from "@/pages/GroupedCustomerReview";
import ManagerDeurReviewPage from "@/pages/ManagerDeurReview";
import ReviewCompletedPage from "@/pages/ReviewCompleted";
import MaintenancePage from "@/pages/Maintenance";
import NewMaintenance from "@/pages/Maintenance/New";
import MaintenanceDetails from "@/pages/Maintenance/Details";
import DailyLogs from "@/pages/DailyLogs";
import NewDailyLog from "@/pages/DailyLogs/New";
import Billing from "@/pages/Billing";
import Reports from "@/pages/Reports";
import ReportPreview from "@/pages/Reports/Preview";
import Settings from "@/pages/Settings";
import DevelopmentEmailOutboxPage from "@/pages/DevelopmentEmailOutbox";
import DevelopmentEmailPreviewPage from "@/pages/DevelopmentEmailOutbox/Preview";
import DevelopmentCustomerReviewOutboxPage from "@/pages/DevelopmentCustomerReviewOutbox";
import DevelopmentCustomerReviewPreview from "@/pages/DevelopmentCustomerReviewOutbox/Preview";
import UsersPage from "@/features/users/pages/UsersPage";
import RolesPage from "@/features/administration/pages/RolesPage";
import PermissionsPage from "@/features/administration/pages/PermissionsPage";
import AuditTrailPage from "@/features/administration/pages/AuditTrailPage";
import DataMigrationPage from "@/pages/DataMigration";
import UatGroupedReviewCertification from "@/pages/UatGroupedReviewCertification";
import { CANONICAL_NAVIGATION_PERMISSIONS } from "./navigation/navigationConfig";

const ActivityCodePage = lazy(() => import("@/features/masters/activity-code/pages"));
const CostCodePage = lazy(() => import("@/features/masters/cost-code/pages"));
const WorkDescriptionPage = lazy(() => import("@/features/masters/work-description/pages"));
const IdleReasonPage = lazy(() => import("@/features/masters/idle-reason/pages"));
const EquipmentSubcategoryPage = lazy(() => import("@/features/masters/equipment-subcategory/pages"));
const CertificationTypesPage = lazy(() => import("@/features/masters/certification-type/pages/CertificationTypesPage"));

function permitted(permission: Permission, element: ReactNode) {
  return <RequirePermission permission={permission}>{element}</RequirePermission>;
}

export const PUBLIC_ROUTE_PATTERNS = Object.freeze([
  "/login",
  "/rental-approval/:token",
  "/customer-deur-review/:deurId",
  "/review/deur/completed",
  "/review/manager/completed",
  "/review/deur/:credential",
  "/review/customer/grouped/:credential",
  "/review/manager/:credential",
]);

export const router = createBrowserRouter([
  { path: "/login", element: <AnonymousRoute><Login /></AnonymousRoute> },
  { path: "/rental-approval/:token", element: <RentalApprovalPage /> },
  { path: "/customer-deur-review/:deurId", element: <CustomerDeurReviewPage /> },
  { path: "/review/deur/completed", element: <ReviewCompletedPage audience="customer" /> },
  { path: "/review/manager/completed", element: <ReviewCompletedPage audience="manager" /> },
  { path: "/review/deur/:credential", element: <CustomerDeurReviewPage /> },
  { path: "/review/customer/grouped/:credential", element: <GroupedCustomerReviewPage /> },
  { path: "/review/manager/:credential", element: <ManagerDeurReviewPage /> },
  {
    path: "/",
    element: <RequireAuthentication><AppLayout /></RequireAuthentication>,
    errorElement: <NotFound />,
    children: [
      { index: true, element: permitted("dashboard.read", <Dashboard />) },
      { path: "dashboard", element: permitted("dashboard.read", <Dashboard />) },
      { path: "access-denied", element: <AccessDenied /> },
      { path: "equipment", element: permitted("equipment.read", <Equipment />) },
      { path: "equipment/new", element: permitted("equipment.create", <NewEquipment />) },
      { path: "equipment/edit/:id", element: permitted("equipment.update", <EditEquipment />) },
      { path: "equipment/trash", element: permitted("equipment.restore", <EquipmentTrash />) },
      { path: "equipment/:id", element: permitted("equipment.read", <EquipmentDetails />) },
      { path: "customers", element: permitted("customer.read", <CustomerPage />) },
      { path: "customers/new", element: permitted("customer.create", <NewCustomer />) },
      { path: "customers/:id", element: permitted("customer.read", <CustomerDetails />) },
      { path: "customers/edit/:id", element: permitted("customer.manage", <EditCustomer />) },
      { path: "operators", element: permitted("operator.read", <Operators />) },
      { path: "operators/new", element: permitted("operator.create", <NewOperator />) },
      { path: "operators/edit/:id", element: permitted("operator.read", <EditOperator />) },
      { path: "projects", element: permitted("project.read", <Projects />) },
      { path: "projects/new", element: permitted("project.manage", <NewProject />) },
      { path: "projects/:id/edit", element: permitted("project.manage", <EditProject />) },
      { path: "assignments", element: permitted("assignment.read", <Assignments />) },
      { path: "assignments/new", element: permitted("assignment.create", <NewAssignment />) },
      { path: "assignments/:id/edit", element: permitted("assignment.manage", <EditAssignment />) },
      { path: "assignments/:id", element: permitted("assignment.read", <AssignmentDetails />) },
      { path: "rentals", element: permitted("rental.read", <RentalPage />) },
      { path: "rentals/new", element: permitted("rental.create", <NewRental />) },
      { path: "rentals/:rentalId/workspace", element: permitted("rental.read", <RentalWorkspacePage />) },
      { path: "rentals/:rentalId/commercial-terms", element: permitted("rental.commercialTerms.manage", <RentalCommercialTermsPage />) },
      { path: "rentals/:rentalId/customer-contact", element: permitted("rental.customerContact.update", <RentalCustomerContactPage />) },
      { path: "rentals/:rentalId/operator-deur", element: permitted("deur.read", <OperatorDeurPage />) },
      { path: "operator", element: permitted("deur.read", <OperatorLandingPage />) },
      { path: "rentals/return/:id", element: permitted("rental.return", <ReturnRental />) },
      { path: "maintenance", element: permitted("maintenance.read", <MaintenancePage />) },
      { path: "maintenance/new", element: permitted("maintenance.manage", <NewMaintenance />) },
      { path: "maintenance/:id", element: permitted("maintenance.read", <MaintenanceDetails />) },
      { path: "daily-logs", element: permitted("dailyLog.read", <DailyLogs />) },
      { path: "daily-logs/new", element: permitted("dailyLog.manage", <NewDailyLog />) },
      { path: "billing", element: permitted("billing.read", <Billing />) },
      { path: "reports", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.reports, <Reports />) },
      { path: "reports/preview", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.reports, <ReportPreview />) },
      { path: "settings", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.settings, <Settings />) },
      { path: "users", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.users, <UsersPage />) },
      { path: "roles", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.roles, <RolesPage />) },
      { path: "permissions", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.permissions, <PermissionsPage />) },
      { path: "audit-trail", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.auditTrail, <AuditTrailPage />) },
      { path: "data-migration", element: permitted(CANONICAL_NAVIGATION_PERMISSIONS.dataMigration, <DataMigrationPage />) },
      { path: "uat/grouped-review-certification", element: permitted("settings.update", <UatGroupedReviewCertification />) },
      { path: "development-email-outbox", element: permitted("settings.manage", <DevelopmentEmailOutboxPage />) },
      { path: "development-email-outbox/:id", element: permitted("settings.manage", <DevelopmentEmailPreviewPage />) },
      { path: "development-customer-review-outbox", element: permitted("settings.manage", <DevelopmentCustomerReviewOutboxPage />) },
      { path: "development-customer-review-outbox/:id", element: permitted("settings.manage", <DevelopmentCustomerReviewPreview />) },
      {
        path: "settings/activity-codes",
        element: permitted("masterData.manage", <Suspense fallback={<div className="p-8 text-slate-500">Loading Activity Codes…</div>}><ActivityCodePage /></Suspense>),
      },
      { path: "settings/cost-codes", element: permitted("masterData.manage", <Suspense fallback={<div className="p-8">Loading Cost Codes…</div>}><CostCodePage /></Suspense>) },
      {
        path: "settings/work-descriptions",
        element: permitted("masterData.manage", <Suspense fallback={<div className="p-8 text-slate-500">Loading Work Descriptions…</div>}><WorkDescriptionPage /></Suspense>),
      },
      { path: "settings/idle-reasons", element: permitted("masterData.manage", <Suspense fallback={<div className="p-8">Loading Idle Reasons…</div>}><IdleReasonPage /></Suspense>) },
      { path: "settings/equipment-subcategories", element: permitted("masterData.read", <Suspense fallback={<div className="p-8">Loading Equipment Sub-Categories…</div>}><EquipmentSubcategoryPage /></Suspense>) },
      { path: "settings/certification-types", element: permitted("masterData.read", <Suspense fallback={<div className="p-8">Loading Certification Types…</div>}><CertificationTypesPage /></Suspense>) },
    ],
  },
]);
