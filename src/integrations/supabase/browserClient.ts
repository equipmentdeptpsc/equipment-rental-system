import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseBrowserConfiguration { url:string; publishableKey:string }
let singleton:SupabaseClient|undefined;
let singletonFingerprint:string|undefined;

export function getSupabaseBrowserClient(configuration:SupabaseBrowserConfiguration):SupabaseClient {
  const fingerprint=`${configuration.url}\u0000${configuration.publishableKey}`;
  if(singleton&&singletonFingerprint!==fingerprint) throw new Error("SUPABASE_CLIENT_CONFIGURATION_CHANGED");
  singleton??=createClient(configuration.url,configuration.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  singletonFingerprint=fingerprint;
  return singleton;
}
