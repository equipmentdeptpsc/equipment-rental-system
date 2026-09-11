import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import matrix from "../docs/rbac/role-permission-matrix.json";
import catalog from "../docs/rbac/canonical-permissions.json";

const ui = readFileSync("src/features/rental/components/RentalQuickActions.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260911000200_align_rental_cancel_catalog_authorization.sql", "utf8");
const historical = readFileSync("supabase/migrations/20260729000900_phase_c3a_rental_lifecycle_commands.sql", "utf8");

function cancelFunction(sql: string): string {
  const marker = sql.includes("CREATE OR REPLACE FUNCTION erp.command_cancel_rental")
    ? "CREATE OR REPLACE FUNCTION erp.command_cancel_rental"
    : "CREATE FUNCTION command_cancel_rental";
  const start = sql.indexOf(marker);
  const end = sql.indexOf("END $$;", start) + "END $$;".length;
  return sql.slice(start, end);
}

function normalizedCancelFunction(sql: string): string {
  return cancelFunction(sql)
    .replace("CREATE OR REPLACE FUNCTION erp.command_cancel_rental", "CREATE FUNCTION command_cancel_rental")
    .replace("'rental.manage'", "'RENTAL_CANCEL_PERMISSION'")
    .replace("'rental.update'", "'RENTAL_CANCEL_PERMISSION'")
    .replace(/\s+/g, " ")
    .trim();
}
function permissions(role: keyof typeof matrix.grants): string[] | "ALL" {
  const grant = matrix.grants[role];
  if ("allPermissions" in grant && grant.allPermissions) return "ALL";
  return [
    ...Object.entries(grant.standard).flatMap(([resource, actions]) => actions.map(action => `${resource}.${action}`)),
    ...grant.workflow,
  ];
}

describe("Catalog 2.0 Rental cancellation authorization", () => {
  it("uses rental.update as the existing granular replacement for deprecated rental.manage", () => {
    const legacy = catalog.deprecatedLegacyPermissions.find(permission => permission.code === "rental.manage");
    expect(legacy).toMatchObject({ active: true, deprecated: true });
    expect(legacy?.replacementCodes).toContain("rental.update");
    expect(catalog.compatibilityAliases.find(alias => alias.legacyCode === "rental.manage")).toMatchObject({ mode: "migration-only" });
  });

  it("keeps cancellation available to the canonical system administrator without role changes", () => {
    expect(permissions("system-administrator")).toBe("ALL");
    expect(permissions("dispatcher")).toContain("rental.update");
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)[\s\S]*role_permissions/i);
    expect(migration).not.toContain("'rental.manage'");
  });

  it("aligns the narrow Cancel UI and canonical RPC to rental.update", () => {
    expect(ui).toContain('cancel: hasPermission("rental.update")');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION erp.command_cancel_rental(command jsonb)");
    expect(migration).toContain("execute_rental_lifecycle_transition(command,'CANCEL_RENTAL',state,'Cancelled','rental.update')");
    expect(migration).toContain("state NOT IN('Draft','Assigned','Reserved')");
    expect(normalizedCancelFunction(migration)).toBe(normalizedCancelFunction(historical));
  });
});
