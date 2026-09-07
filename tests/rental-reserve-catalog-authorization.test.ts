import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import matrix from "../docs/rbac/role-permission-matrix.json";
import catalog from "../docs/rbac/canonical-permissions.json";

const ui = readFileSync("src/features/rental/components/RentalQuickActions.tsx", "utf8");
const applicationPermissions = readFileSync("src/features/auth/domain/permission.ts", "utf8");
const historical = readFileSync("supabase/migrations/20260822000250_canonical_rental_front_half.sql", "utf8");
const migration = readFileSync("supabase/migrations/20260825000400_canonical_rental_reserve_catalog_authorization.sql", "utf8");

function permissions(role: keyof typeof matrix.grants): string[] | "ALL" {
  const grant = matrix.grants[role];
  if ("allPermissions" in grant && grant.allPermissions) return "ALL";
  return [
    ...Object.entries(grant.standard).flatMap(([resource, actions]) => actions.map(action => `${resource}.${action}`)),
    ...grant.workflow,
  ];
}

function reserveFunction(sql: string): string {
  const start = sql.indexOf(sql.includes("CREATE OR REPLACE FUNCTION erp.command_reserve_rental")
    ? "CREATE OR REPLACE FUNCTION erp.command_reserve_rental"
    : "CREATE FUNCTION erp.command_reserve_rental");
  const end = sql.indexOf("END $$;", start) + "END $$;".length;
  return sql.slice(start, end);
}

function normalizedReserveBody(sql: string): string {
  return reserveFunction(sql)
    .replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")
    .replace("current_user_has_permission('rental.update')", "current_user_has_permission('RESERVE_PERMISSION')")
    .replace("current_user_has_permission('rental.manage')", "current_user_has_permission('RESERVE_PERMISSION')")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Catalog 2.0 Rental Reserve authorization", () => {
  it("uses the documented granular replacement for deprecated rental.manage", () => {
    const legacy = catalog.deprecatedLegacyPermissions.find(permission => permission.code === "rental.manage");
    expect(legacy).toMatchObject({ active: true, deprecated: true });
    expect(legacy?.replacementCodes).toContain("rental.update");
    expect(catalog.compatibilityAliases.find(alias => alias.legacyCode === "rental.manage")).toMatchObject({ mode: "migration-only" });
  });

  it("matches the canonical role matrix without restoring legacy authority", () => {
    expect(permissions("system-administrator")).toBe("ALL");
    expect(permissions("dispatcher")).toContain("rental.update");
    for (const role of ["operations-manager", "equipment-coordinator", "billing-staff"] as const) {
      expect(permissions(role)).not.toContain("rental.update");
    }
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)[\s\S]*role_permissions/i);
    expect(migration).not.toContain("'rental.manage'");
  });

  it("aligns the UI and forward-only RPC mutation to rental.update", () => {
    expect(applicationPermissions).toContain('"rental.update"');
    expect(ui).toContain('reserve: hasPermission("rental.update")');
    expect(ui).toContain('approval === "Approved" ? { actions: (canonicalOperationalMutations || canonicalReserveMutations) && permissions.reserve');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp.command_reserve_rental(command jsonb)");
    expect(migration).toContain("current_user_has_permission('rental.update')");
    expect(historical).toContain("current_user_has_permission('rental.manage')");
    expect(normalizedReserveBody(migration)).toBe(normalizedReserveBody(historical));
  });

  it("preserves Reserve lifecycle, audit, idempotency, actor, and tenant semantics", () => {
    for (const fragment of [
      "erp.current_company_id()", "auth.uid()", "target.status<>'Draft' OR target.approval_status<>'Approved'",
      "expected<>target.row_version", "begin_operational_command(command,'RESERVE_RENTAL'",
      "finish_operational_command(command,'RESERVE_RENTAL'", "'RENTAL_RESERVED'", "SET status='Reserved'",
    ]) expect(migration).toContain(fragment);
  });

  it("leaves Release on its dedicated Catalog 2.0 permission", () => {
    expect(ui).toContain('release: hasPermission("rental.release")');
    expect(historical).toContain("current_user_has_permission('rental.release')");
    expect(migration).not.toContain("command_release_rental");
  });
});
