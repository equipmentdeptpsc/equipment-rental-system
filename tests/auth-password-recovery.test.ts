import { describe, expect, it, vi } from "vitest";
import { hasRecoveryCallback, restoreRecoverySession } from "@/features/auth/recovery";
import { repositorySuccess } from "@/core/persistence";
import { readFileSync } from "node:fs";

describe("Supabase password recovery", () => {
  it("detects recovery callbacks without exposing tokens", () => {
    expect(hasRecoveryCallback({ hash: "#type=recovery&access_token=secret", search: "" })).toBe(true);
    expect(readFileSync("src/pages/ResetPassword.tsx", "utf8")).not.toMatch(/access_token|refresh_token|console\\./);
  });
  it("establishes a valid recovery callback session", async () => {
    const identity = { session: { id: "session", userId: "user", providerId: "supabase", createdAt: "now" }, user: { id: "user" } as never, permissions: [] };
    const provider = { restoreSession: vi.fn(async () => repositorySuccess(identity)) } as never;
    await expect(restoreRecoverySession(provider)).resolves.toMatchObject({ success: true, value: identity });
  });
  it("renders invalid or expired recovery as a safe failure", async () => {
    const provider = { restoreSession: vi.fn(async () => repositorySuccess(null)) } as never;
    await expect(restoreRecoverySession(provider)).resolves.toMatchObject({ success: true, value: null });
    expect(readFileSync("src/pages/ResetPassword.tsx", "utf8")).toContain("expired or invalid");
  });
  it("falls back when restoreSession remains pending", async () => {
    vi.useFakeTimers();
    try {
      const provider = { restoreSession: () => new Promise<never>(() => {}) } as never;
      const pending = restoreRecoverySession(provider, 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("keeps mismatch validation client-side and uses canonical updateUser password flow", () => {
    const page = readFileSync("src/pages/ResetPassword.tsx", "utf8");
    const provider = readFileSync("src/integrations/supabase/SupabaseAuthenticationProvider.ts", "utf8");
    expect(page).toContain("Passwords do not match.");
    expect(provider).toContain("this.client.auth.updateUser({ password })");
  });
  it("keeps normal login route separate and preserves the callback URL", () => {
    const router = readFileSync("src/app/router.tsx", "utf8");
    expect(router).toContain('path: "/login"');
    expect(router).toContain('path: "/reset-password"');
    expect(router).toContain("hash: window.location.hash");
  });
});