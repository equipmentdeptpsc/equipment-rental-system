import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationDependencyContext } from "@/app/composition/dependencyContext";
import { PersistenceMode, type ApplicationDependencies } from "@/app/composition/ApplicationDependencies";
import RentalQuickActions from "@/features/rental/components/RentalQuickActions";
import type { RentalRecord } from "@/features/rental/types";
import { SupabaseOperationalCommandRepository } from "@/integrations/supabase/SupabaseOperationalCommandRepository";

const auth = vi.hoisted(() => ({ permissions: new Set<string>(["rental.return"]) }));
const mocks = vi.hoisted(() => ({ showToast: vi.fn(), refresh: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", name: "Admin" }, hasPermission: (permission: string) => auth.permissions.has(permission) }) }));
vi.mock("@/components/ui/toast/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/features/rental/context/RentalContext", () => ({ useRental: () => ({ transitionRental: vi.fn(), returnRental: vi.fn(), releaseRental: vi.fn(), submitForApproval: vi.fn(), approveRental: vi.fn(), rejectRental: vi.fn(), getReleaseReadiness: () => ({ eligible: true }) }) }));
vi.mock("@/features/rental/remote/canonicalRentalRefresh", () => ({ requestCanonicalRentalRefresh: mocks.refresh }));

const migration = readFileSync("supabase/migrations/20260729000300_phase_c2_mutation_functions.sql", "utf8");
const finalLineMutation = readFileSync("supabase/migrations/20260729002400_phase_c4d_command_lookup_and_status_fix.sql", "utf8");
const expectationGate = readFileSync("supabase/migrations/20260828000200_canonical_rental_return_expectation_gate.sql", "utf8");
const roots: Root[] = [];
const active = { id: "rental-1", rentalNumber: "R-1", status: "Active", approvalStatus: "Approved", rowVersion: 8 } as RentalRecord;

function dependencies(returnAll = vi.fn(async () => ({ success: true, disposition: "ACCEPTED", value: { rentalId: active.id, lines: [], version: 1 } } as const)), ready = true) {
  const unavailable = vi.fn();
  return {
    configuration: { persistenceMode: PersistenceMode.Remote, equipmentStatusSource: "supabase", remoteOperationalWritesEnabled: true },
    commandRepositories: {
      canonicalRental: { activate: unavailable },
      rentalReturnCommands: { returnLine: unavailable, returnAll, getReturnReadiness: vi.fn(async () => ({ success: true, disposition: "ACCEPTED", serverOccurredAt: "2026-08-28T00:00:00Z", refresh: [], value: { rentalId: active.id, ready, historicalBoundary: "2026-08-27", blockers: ready ? [] : [{ code: "DEUR_EXPECTATION_UNRESOLVED", message: "Required historical DEUR expectation is unresolved.", rentalLineId: "line-1", workDate: "2026-08-27" }] } })) },
    },
  } as unknown as ApplicationDependencies;
}
async function render(input = dependencies()) {
  const container = document.createElement("div"); const root = createRoot(container); roots.push(root);
  await act(async () => root.render(createElement(
    ApplicationDependencyContext.Provider,
    { value: input },
    createElement(MemoryRouter, null, createElement(RentalQuickActions, { rental: active })),
  )));
  return container;
}

beforeEach(() => { vi.clearAllMocks(); auth.permissions = new Set(["rental.return"]); });
afterEach(async () => { while (roots.length) await act(async () => roots.pop()?.unmount()); });

describe("canonical remote Rental Return remediation", () => {
  it("retains the authenticated tenant-scoped canonical command and final line mutation", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION command_return_all_rental_lines(command jsonb)");
    expect(migration).toContain("current_user_has_permission('rental.return')");
    expect(finalLineMutation).toContain("CREATE OR REPLACE FUNCTION command_return_rental_line(command jsonb)");
    expect(finalLineMutation).toContain("UPDATE erp.assignments AS a SET status='Completed'");
    expect(finalLineMutation).toContain("UPDATE erp.equipment AS e SET status_id=available_status");
    expect(expectationGate).toContain("CREATE OR REPLACE FUNCTION erp.get_rental_return_readiness(command jsonb)");
    expect(expectationGate).toContain("today_local-1");
    expect(expectationGate).toContain("d.superseded_by_revision_id IS NULL AND d.status IN('Acknowledged','Billed')");
    expect(expectationGate).toContain("disposition.disposition='WAIVED'");
    expect(expectationGate.indexOf("idem->>'state'='REPLAY'")).toBeLessThan(expectationGate.indexOf("target.row_version<>coalesce"));
    expect(expectationGate).toContain("RETURN jsonb_build_object('success',false,'code','CONFLICT'");
    expect(expectationGate).toContain("IF readiness->'value'->>'ready'<>'true' THEN RETURN");
    expect(expectationGate).toContain("IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Atomic return blocked'");
  });

  it("maps returnAll to the canonical RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, disposition: "ACCEPTED", value: { rentalId: active.id, lines: [], version: 1 } }, error: null });
    await new SupabaseOperationalCommandRepository({ schema: () => ({ rpc }) }).returnAll({ commandId: "c", idempotencyKey: "i", rentalId: active.id, actualReturnDate: "2026-09-06" });
    expect(rpc).toHaveBeenCalledWith("command_return_all_rental_lines", { command: { commandId: "c", idempotencyKey: "i", rentalId: active.id, actualReturnDate: "2026-09-06" } });
  });

  it("shows Return only for authorized Active Rentals and dispatches once", async () => {
    const returnAll = vi.fn(async () => ({ success: true, disposition: "ACCEPTED", value: { rentalId: active.id, lines: [], version: 1 } } as const));
    const container = await render(dependencies(returnAll)); await act(async () => { await Promise.resolve(); }); const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Return Equipment")!;
    expect(button).toBeTruthy();
    const date = container.querySelector<HTMLInputElement>('input[aria-label="Return business date"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "2026-09-06"); date.dispatchEvent(new Event("input", { bubbles: true })); button.click(); button.click(); await Promise.resolve(); });
    expect(returnAll).toHaveBeenCalledTimes(1);
    expect(returnAll).toHaveBeenCalledWith({ commandId: expect.any(String), idempotencyKey: expect.any(String), rentalId: active.id, actualReturnDate: "2026-09-06", expectedVersion: 8 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the server reports an unresolved historical expectation", async () => {
    const returnAll = vi.fn(); const container = await render(dependencies(returnAll, false)); await act(async () => { await Promise.resolve(); });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Return Equipment")!;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("historical DEUR expectation");
    button.click(); expect(returnAll).not.toHaveBeenCalled();
  });

  it("hides Return without rental.return", async () => {
    auth.permissions.clear();
    expect((await render()).textContent).not.toContain("Return Equipment");
  });
});
