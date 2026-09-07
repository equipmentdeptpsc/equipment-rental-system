import { describe, expect, it } from "vitest";
import { PersistenceMode, createLocalApplicationDependencies } from "@/app/composition";
import { canUseCanonicalRemoteRentalReturnMutation } from "@/features/rental/services/rentalRuntimeCapability";

describe("narrow remote Rental Return capability", () => {
  it("is disabled by default and requires remote persistence", () => {
    const local = createLocalApplicationDependencies().configuration;
    expect(local.remoteRentalReturnEnabled).toBe(false);
    expect(canUseCanonicalRemoteRentalReturnMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false })).toBe(false);
    expect(canUseCanonicalRemoteRentalReturnMutation({ ...local, persistenceMode: PersistenceMode.Remote, remoteOperationalWritesEnabled: false, remoteRentalReturnEnabled: true })).toBe(true);
    expect(canUseCanonicalRemoteRentalReturnMutation({ ...local, persistenceMode: PersistenceMode.Local, remoteRentalReturnEnabled: true })).toBe(false);
  });
});
