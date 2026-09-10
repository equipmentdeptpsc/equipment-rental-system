import { describe, expect, it } from "vitest";
import { hasRecoveryCallback } from "@/features/auth/recovery";
import { readFileSync } from "node:fs";

describe("Supabase password recovery", () => {
  it("detects recovery callbacks without exposing tokens", () => {
    expect(hasRecoveryCallback({ hash: "#type=recovery&access_token=secret", search: "" })).toBe(true);
    expect(readFileSync("src/pages/ResetPassword.tsx", "utf8")).not.toMatch(/access_token|refresh_token|console\\./);
  });
  it("keeps mismatch validation client-side and uses canonical updatePassword", () => {
    const page = readFileSync("src/pages/ResetPassword.tsx", "utf8");
    const provider = readFileSync("src/integrations/supabase/SupabaseAuthenticationProvider.ts", "utf8");
    expect(page).toContain("Passwords do not match.");
    expect(provider).toContain("this.client.auth.updateUser({ password })");
  });
  it("keeps normal login route separate", () => {
    const router = readFileSync("src/app/router.tsx", "utf8");
    expect(router).toContain('path: "/login"');
    expect(router).toContain('path: "/reset-password"');
  });
});