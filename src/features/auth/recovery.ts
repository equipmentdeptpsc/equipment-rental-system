export function hasRecoveryCallback(location: Pick<Location, "hash" | "search"> = window.location): boolean {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return search.get("type") === "recovery" || hash.get("type") === "recovery" || Boolean(search.get("error")) || Boolean(hash.get("error"));
}
export function clearRecoveryCallbackUrl(): void { if (typeof window !== "undefined") window.history.replaceState({}, document.title, window.location.pathname); }