import { describe, expect, it } from "vitest";
import { PersistenceMode, createLocalApplicationDependencies } from "@/app/composition";
import { canUseCanonicalRemoteRentalActivateMutation } from "@/features/rental/services/rentalRuntimeCapability";

describe("narrow remote Rental Activate capability", () => {
  it("is disabled by default and requires remote persistence", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(local.remoteRentalActivateEnabled).toBe(false);
    expect(canUseCanonicalRemoteRentalActivateMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalActivateMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalActivateEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalActivateMutation({ ...local, persistenceMode: PersistenceMode.Local, remoteRentalActivateEnabled: true })).toBe(false);
  });
});
