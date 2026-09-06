import { describe, expect, it } from "vitest";
import { resolveRuntimeEnvironment } from "@/app/composition";

const remote = { persistenceMode: "remote", supabaseUrl: "https://jtkctarqbwmqdcewthkn.supabase.co", supabasePublishableKey: "browser-safe-key" };

describe("runtime environment fail-closed resolution", () => {
  it("allows valid remote UAT and production composition", () => {
    expect(resolveRuntimeEnvironment({ ...remote, hostname: "uat.pscequipment.online" }).kind).toBe("remote");
    expect(resolveRuntimeEnvironment({ ...remote, hostname: "pscequipment.online" }).kind).toBe("remote");
  });
  it("rejects missing, local, and incomplete remote UAT composition", () => {
    expect(resolveRuntimeEnvironment({ hostname: "uat.pscequipment.online" }).kind).toBe("configuration-error");
    expect(resolveRuntimeEnvironment({ persistenceMode: "local", hostname: "uat.pscequipment.online" }).kind).toBe("configuration-error");
    expect(resolveRuntimeEnvironment({ persistenceMode: "remote", hostname: "uat.pscequipment.online" }).kind).toBe("configuration-error");
  });
  it("rejects local or missing production composition", () => {
    expect(resolveRuntimeEnvironment({ persistenceMode: "local", hostname: "pscequipment.online" }).kind).toBe("configuration-error");
    expect(resolveRuntimeEnvironment({ hostname: "pscequipment.online" }).kind).toBe("configuration-error");
  });
  it("allows local composition only on explicit local hosts", () => {
    expect(resolveRuntimeEnvironment({ persistenceMode: "local", hostname: "localhost" }).kind).toBe("local");
    expect(resolveRuntimeEnvironment({ hostname: "localhost" }).kind).toBe("configuration-error");
  });
});
