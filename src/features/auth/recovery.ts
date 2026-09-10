import type { RemoteAuthenticatedIdentity, RemoteAuthenticationProvider } from "./providers/RemoteAuthenticationProvider";
import type { RepositoryResult } from "@/core/persistence";

export type RecoveryCallback =
  | { kind: "pkce"; code: string }
  | { kind: "implicit"; accessToken: string; refreshToken: string }
  | { kind: "invalid" }
  | { kind: "none" };

type RecoveryLocation = Pick<Location, "hash" | "search">;

export function getRecoveryCallback(location: RecoveryLocation = window.location): RecoveryCallback {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (search.get("error") || hash.get("error")) return { kind: "invalid" };
  const code = search.get("code");
  if (code) return { kind: "pkce", code };
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (hash.get("type") === "recovery" && accessToken && refreshToken) return { kind: "implicit", accessToken, refreshToken };
  return hash.get("type") === "recovery" ? { kind: "invalid" } : { kind: "none" };
}

export function hasRecoveryCallback(location: RecoveryLocation = window.location): boolean { return getRecoveryCallback(location).kind !== "none"; }

export async function restoreRecoverySession(provider: RemoteAuthenticationProvider | undefined, timeoutMs = 8000, location: RecoveryLocation = window.location): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null> | null> {
  if (!provider) return null;
  const callback = getRecoveryCallback(location);
  if (callback.kind === "invalid") return null;
  const establish = callback.kind === "none" ? provider.restoreSession() : provider.establishRecoverySession(callback);
  const result = await Promise.race([establish, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs))]);
  if (result?.success && callback.kind !== "none") clearRecoveryCallbackUrl();
  return result;
}

export function clearRecoveryCallbackUrl(): void { if (typeof window !== "undefined") window.history.replaceState({}, document.title, window.location.pathname); }