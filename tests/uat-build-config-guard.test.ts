import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const guard = path.resolve("scripts/validate-uat-build.mjs");
const base = { VITE_PERSISTENCE_MODE: "remote", VITE_SUPABASE_URL: "https://jtkctarqbwmqdcewthkn.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890", VITE_REMOTE_OPERATIONAL_WRITES_ENABLED: "false" };

describe("UAT build configuration guard", () => {
  it("accepts the alternate process key name", () => {
    const { VITE_SUPABASE_PUBLISHABLE_KEY: _ignored, ...withoutViteKey } = base;
    expect(() => execFileSync(process.execPath, [guard], { env: { ...process.env, ...withoutViteKey, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890" }, stdio: "pipe" })).not.toThrow();
  });
  it("accepts isolated UAT remote configuration", () => {
    expect(() => execFileSync(process.execPath, [guard], { env: { ...process.env, ...base }, stdio: "pipe" })).not.toThrow();
  });
  it.each([
    ["missing key", { VITE_SUPABASE_PUBLISHABLE_KEY: "" }],
    ["invalid key shape", { VITE_SUPABASE_PUBLISHABLE_KEY: "\u0016" }],
    ["wrong URL", { VITE_SUPABASE_URL: "https://other.supabase.co" }],
    ["non-remote mode", { VITE_PERSISTENCE_MODE: "local" }],
    ["broad writes enabled", { VITE_REMOTE_OPERATIONAL_WRITES_ENABLED: "true" }],
  ])("fails closed for %s", (_label, override) => {
    expect(() => execFileSync(process.execPath, [guard], { env: { ...process.env, ...base, ...override }, stdio: "pipe" })).toThrow();
  });
});