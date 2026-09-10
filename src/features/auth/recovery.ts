import type { RemoteAuthenticatedIdentity, RemoteAuthenticationProvider } from "./providers/RemoteAuthenticationProvider";
import type { RepositoryResult } from "@/core/persistence";

export function hasRecoveryCallback(location: Pick<Location, "hash" | "search"> = window.location): boolean {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return search.get("type") === "recovery" || hash.get("type") === "recovery" || Boolean(search.get("error")) || Boolean(hash.get("error"));
}

export function restoreRecoverySession(provider: RemoteAuthenticationProvider | undefined, timeoutMs = 8000): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null> | null> {
  if (!provider) return Promise.resolve(null);
  return Promise.race([
    provider.restoreSession(),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export function clearRecoveryCallbackUrl(): void { if (typeof window !== "undefined") window.history.replaceState({}, document.title, window.location.pathname); }