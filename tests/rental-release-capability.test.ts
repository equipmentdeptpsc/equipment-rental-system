import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PersistenceMode, createLocalApplicationDependencies } from "@/app/composition";
import { canUseCanonicalRemoteRentalReleaseMutation } from "@/features/rental/services/rentalRuntimeCapability";

const quickActions = readFileSync("src/features/rental/components/RentalQuickActions.tsx", "utf8");
const releaseAction = readFileSync("src/features/rental/components/ReleaseRentalAction.tsx", "utf8");
const composition = readFileSync("src/app/composition/createApplicationDependencies.ts", "utf8");

describe("narrow remote Rental Release capability", () => {
  it("is disabled by default and requires remote persistence", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(local.remoteRentalReleaseEnabled).toBe(false);
    expect(canUseCanonicalRemoteRentalReleaseMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalReleaseMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalReleaseEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalReleaseMutation({ ...local, persistenceMode: PersistenceMode.Local, remoteRentalReleaseEnabled: true })).toBe(false);
  });

  it("composes only the typed canonical Release repository action", () => {
    expect(composition).toContain("VITE_REMOTE_RENTAL_RELEASE_ENABLED");
    expect(quickActions).toContain("canUseCanonicalRemoteRentalReleaseMutation(configuration)");
    expect(quickActions).toContain("canonicalReleaseMutations && action.id === \"release\"");
    expect(releaseAction).toContain("canUseCanonicalRemoteRentalReleaseMutation(configuration)");
    expect(releaseAction).toContain('hasPermission("rental.release")');
    expect(quickActions).toContain("canonicalOperationalMutations || canonicalReleaseMutations");
    expect(quickActions).not.toContain("remoteRentalReleaseEnabled: configuration.remoteOperationalWritesEnabled");
  });
});
