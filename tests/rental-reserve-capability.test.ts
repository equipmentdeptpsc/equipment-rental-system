import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PersistenceMode, createLocalApplicationDependencies } from "@/app/composition";
import { canUseCanonicalRemoteRentalReserveMutation } from "@/features/rental/services/rentalRuntimeCapability";

const ui = readFileSync("src/features/rental/components/RentalQuickActions.tsx", "utf8");
const composition = readFileSync("src/app/composition/createApplicationDependencies.ts", "utf8");

describe("narrow remote Rental Reserve capability", () => {
  it("is disabled by default and requires remote persistence", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(local.remoteRentalReserveEnabled).toBe(false);
    expect(canUseCanonicalRemoteRentalReserveMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalReserveMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalReserveEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalReserveMutation({ ...local, persistenceMode: PersistenceMode.Local, remoteRentalReserveEnabled: true })).toBe(false);
  });

  it("composes only the typed canonical Reserve repository action", () => {
    expect(composition).toContain("VITE_REMOTE_RENTAL_RESERVE_ENABLED");
    expect(ui).toContain("canUseCanonicalRemoteRentalReserveMutation(configuration)");
    expect(ui).toContain("id === \"reserve\" && (canonicalOperationalMutations || canonicalReserveMutations)");
    expect(ui).toContain("canonicalReserveMutations && action.id === \"reserve\"");
  });
});
