import { describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getRecoveryCallback, hasRecoveryCallback, restoreRecoverySession } from "@/features/auth/recovery";
import { repositorySuccess } from "@/core/persistence";
import { SupabaseAuthenticationProvider } from "@/integrations/supabase/SupabaseAuthenticationProvider";
import { readFileSync } from "node:fs";

const session = { access_token: "test-access", refresh_token: "test-refresh", user: { id: "user-1", last_sign_in_at: null }, expires_at: null } as unknown as Session;
function providerWith(clientAuth: Record<string, unknown>) {
  const query = { select: () => query, eq: vi.fn(async () => ({ data: [], error: null })) };
  const client = { auth: clientAuth, schema: () => ({ from: () => query }) } as unknown as SupabaseClient;
  const users = { getById: vi.fn(async () => repositorySuccess({ id: "user-1", status: "active" } as never)) } as never;
  return new SupabaseAuthenticationProvider(client, users);
}

describe("Supabase password recovery", () => {
  it("detects the supported PKCE and implicit callback forms without exposing tokens", () => {
    expect(getRecoveryCallback({ search: "?code=opaque-code", hash: "" })).toMatchObject({ kind: "pkce" });
    expect(getRecoveryCallback({ search: "", hash: "#type=recovery&access_token=test&refresh_token=test" })).toMatchObject({ kind: "implicit" });
    expect(hasRecoveryCallback({ hash: "#type=recovery", search: "" })).toBe(true);
    const source = ["src/pages/ResetPassword.tsx", "src/features/auth/recovery.ts", "src/integrations/supabase/SupabaseAuthenticationProvider.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/console\\./);
  });
  it("exchanges a PKCE recovery code before identity validation", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ data: { session }, error: null }));
    const provider = providerWith({ exchangeCodeForSession, setSession: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() });
    await expect(provider.establishRecoverySession({ kind: "pkce", code: "opaque-code" })).resolves.toMatchObject({ success: true, value: { user: { id: "user-1" } } });
    expect(exchangeCodeForSession).toHaveBeenCalledWith("opaque-code");
  });
  it("installs an implicit recovery session before identity validation", async () => {
    const setSession = vi.fn(async () => ({ data: { session }, error: null }));
    const provider = providerWith({ exchangeCodeForSession: vi.fn(), setSession, getSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() });
    await expect(provider.establishRecoverySession({ kind: "implicit", accessToken: "test", refreshToken: "test" })).resolves.toMatchObject({ success: true, value: { user: { id: "user-1" } } });
    expect(setSession).toHaveBeenCalledTimes(1);
  });
  it("returns a safe failure when callback exchange fails", async () => {
    const provider = providerWith({ exchangeCodeForSession: vi.fn(async () => ({ data: { session: null }, error: { message: "expired", status: 400 } })), setSession: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() });
    await expect(provider.establishRecoverySession({ kind: "pkce", code: "expired" })).resolves.toMatchObject({ success: false });
  });
  it("falls back safely when callback establishment remains pending", async () => {
    vi.useFakeTimers();
    try {
      const provider = { restoreSession: vi.fn(), establishRecoverySession: () => new Promise<never>(() => {}) } as never;
      const pending = restoreRecoverySession(provider, 50, { search: "?code=opaque", hash: "" });
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("updates the password through the canonical client", async () => {
    const updateUser = vi.fn(async () => ({ data: { user: null }, error: null }));
    const provider = providerWith({ exchangeCodeForSession: vi.fn(), setSession: vi.fn(), getSession: vi.fn(), updateUser, signOut: vi.fn() });
    await expect(provider.updatePassword("NewPassword1!")).resolves.toMatchObject({ success: true });
    expect(updateUser).toHaveBeenCalledWith({ password: "NewPassword1!" });
  });
  it("renders expired callbacks safely and keeps normal login separate", () => {
    expect(getRecoveryCallback({ search: "?error=access_denied", hash: "" })).toEqual({ kind: "invalid" });
    const page = readFileSync("src/pages/ResetPassword.tsx", "utf8");
    const router = readFileSync("src/app/router.tsx", "utf8");
    expect(page).toContain("Passwords do not match.");
    expect(page).toContain("expired or invalid");
    expect(router).toContain('path: "/login"');
    expect(router).toContain('path: "/reset-password"');
  });
});