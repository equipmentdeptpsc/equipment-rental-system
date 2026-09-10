const expectedProjectRef = "jtkctarqbwmqdcewthkn";
const required = ["VITE_PERSISTENCE_MODE", "VITE_SUPABASE_URL"];
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const supportedPublishableKey = /^(?:sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(publishableKey ?? "");
const missing = required.filter((key) => !process.env[key]?.trim());
if (!publishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY");
else if (!supportedPublishableKey) missing.push("a supported Supabase publishable-key shape");
if (process.env.VITE_PERSISTENCE_MODE !== "remote" || process.env.VITE_REMOTE_OPERATIONAL_WRITES_ENABLED === "true" || missing.length) {
  console.error(`UAT build configuration invalid: ${missing.length ? `missing ${missing.join(", ")}` : "VITE_PERSISTENCE_MODE must be remote"}.`);
  process.exit(1);
}
try {
  const url = new URL(process.env.VITE_SUPABASE_URL);
  if (url.protocol !== "https:" || url.hostname !== `${expectedProjectRef}.supabase.co`) throw new Error();
} catch {
  console.error(`UAT build configuration invalid: VITE_SUPABASE_URL must target ${expectedProjectRef}.supabase.co over HTTPS.`);
  process.exit(1);
}
console.log("PASS UAT build configuration");
