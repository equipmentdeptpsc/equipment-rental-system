export interface RuntimeEnvironmentInput {
  persistenceMode?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  hostname?: string;
}

export type RuntimeEnvironmentResolution =
  | { kind: "local"; persistenceMode: "local" }
  | { kind: "remote"; persistenceMode: "remote" }
  | { kind: "configuration-error"; message: string };

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const deployedHosts = new Set(["uat.pscequipment.online", "pscequipment.online", "www.pscequipment.online"]);

function hasRemoteConfiguration(input: RuntimeEnvironmentInput) {
  if (!input.supabaseUrl?.trim() || !input.supabasePublishableKey?.trim()) return false;
  try { return new URL(input.supabaseUrl).protocol === "https:"; } catch { return false; }
}

export function resolveRuntimeEnvironment(input: RuntimeEnvironmentInput): RuntimeEnvironmentResolution {
  const hostname = input.hostname?.trim().toLowerCase() ?? "";
  const mode = input.persistenceMode?.trim();
  const deployed = deployedHosts.has(hostname);

  if (mode !== "local" && mode !== "remote") return { kind: "configuration-error", message: "This deployment is not configured for its required authentication mode." };
  if (deployed && mode !== "remote") return { kind: "configuration-error", message: "This deployment is not configured for remote authentication." };
  if (mode === "remote" && !hasRemoteConfiguration(input)) return { kind: "configuration-error", message: "This deployment is missing required remote authentication configuration." };
  if (mode === "local" && !localHosts.has(hostname)) return { kind: "configuration-error", message: "Local authentication is permitted only on an approved local development host." };
  return mode === "remote" ? { kind: "remote", persistenceMode: "remote" } : { kind: "local", persistenceMode: "local" };
}
