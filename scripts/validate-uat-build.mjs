const required = ["VITE_PERSISTENCE_MODE", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (process.env.VITE_PERSISTENCE_MODE !== "remote" || missing.length) {
  console.error(`UAT build configuration invalid: ${missing.length ? `missing ${missing.join(", ")}` : "VITE_PERSISTENCE_MODE must be remote"}.`);
  process.exit(1);
}
try {
  if (new URL(process.env.VITE_SUPABASE_URL).protocol !== "https:") throw new Error();
} catch {
  console.error("UAT build configuration invalid: VITE_SUPABASE_URL must be HTTPS.");
  process.exit(1);
}
console.log("PASS UAT build configuration");
