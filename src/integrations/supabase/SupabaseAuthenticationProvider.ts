import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { repositoryFailure, repositorySuccess, type RepositoryResult } from "@/core/persistence";
import type { ReadOnlyRepository } from "@/core/remote";
import type { RemoteAuthenticatedIdentity, RemoteAuthenticationProvider } from "@/features/auth/providers/RemoteAuthenticationProvider";
import type { User } from "@/features/auth/domain/user";

export class SupabaseAuthenticationProvider implements RemoteAuthenticationProvider {
  readonly id = "supabase";
  constructor(private readonly client: SupabaseClient, private readonly users: ReadOnlyRepository<User>) {}

  async login(credentials: { username: string; password: string }): Promise<RepositoryResult<RemoteAuthenticatedIdentity>> {
    const identifier=credentials.username.trim();
    let session:Session|undefined;
    if(isEmail(identifier)){
      const response=await this.client.auth.signInWithPassword({email:identifier,password:credentials.password});
      if(response.error||!response.data.session)return interactiveAuthFailure();
      session=response.data.session;
    }else{
      const response=await fetch("/api/auth/username-login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier,password:credentials.password})}).catch(()=>null);
      const payload=response?await response.json().catch(()=>null) as {success?:boolean;session?:{accessToken?:unknown;refreshToken?:unknown}}|null:null;
      if(!response?.ok||payload?.success!==true||typeof payload.session?.accessToken!=="string"||typeof payload.session.refreshToken!=="string")return interactiveAuthFailure();
      const installed=await this.client.auth.setSession({access_token:payload.session.accessToken,refresh_token:payload.session.refreshToken});
      if(installed.error||!installed.data.session)return interactiveAuthFailure();
      session=installed.data.session;
    }
    const resolved=await this.resolveIdentity(session);
    if(!resolved.success||!resolved.value){await this.client.auth.signOut();return interactiveAuthFailure();}
    return resolved as RepositoryResult<RemoteAuthenticatedIdentity>;
  }
  async logout(): Promise<RepositoryResult<void>> {
    const response = await this.client.auth.signOut();
    return response.error ? authFailure(response.error, "SUPABASE_LOGOUT_FAILED") : repositorySuccess(undefined);
  }
  async restoreSession(): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>> {
    const response = await this.client.auth.getSession();
    if (response.error) return authFailure(response.error, "SUPABASE_SESSION_RESTORE_FAILED");
    return response.data.session ? this.resolveIdentity(response.data.session) : repositorySuccess(null);
  }
  async refreshSession(): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>> {
    const response = await this.client.auth.refreshSession();
    if (response.error) return authFailure(response.error, "SUPABASE_SESSION_REFRESH_FAILED");
    return response.data.session ? this.resolveIdentity(response.data.session) : repositorySuccess(null);
  }
  async getCurrentUser(): Promise<RepositoryResult<User | null>> {
    const restored = await this.restoreSession();
    return restored.success ? repositorySuccess(restored.value?.user ?? null) : restored;
  }
  async updatePassword(password: string): Promise<RepositoryResult<void>> {
    const response = await this.client.auth.updateUser({ password });
    return response.error ? authFailure(response.error, "SUPABASE_PASSWORD_UPDATE_FAILED") : repositorySuccess(undefined);
  }
  private async resolveIdentity(session: Session): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>> {
    const userResult = await this.users.getById(session.user.id);
    if (!userResult.success) return userResult;
    if (!userResult.value || userResult.value.status !== "active") {
      await this.client.auth.signOut();
      return repositoryFailure("REMOTE_USER_UNAVAILABLE", "The authenticated application User is missing or inactive.", {
        context: { userId: session.user.id }, recoverability: "USER_ACTION_REQUIRED",
        recommendedAction: "Ask an administrator to activate and provision the application User.",
      });
    }
    const permissionResponse = await this.client.schema("erp").from("effective_user_permissions").select("permission_code").eq("user_id", session.user.id);
    if (permissionResponse.error) return authFailure(permissionResponse.error, "SUPABASE_PERMISSION_LOAD_FAILED");
    const permissions = (permissionResponse.data ?? []).flatMap((row) => typeof row.permission_code === "string" ? [row.permission_code] : []);
    return repositorySuccess({
      session: { id: session.access_token.slice(-32), userId: session.user.id, providerId: this.id, createdAt: new Date(session.user.last_sign_in_at ?? Date.now()).toISOString(), expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : undefined },
      user: userResult.value,
      permissions,
    });
  }
}
function isEmail(identifier:string):boolean{return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)}
function interactiveAuthFailure<T>():RepositoryResult<T>{
  return repositoryFailure("REMOTE_AUTHORIZATION_DENIED","Invalid username/email or password.",{recoverability:"USER_ACTION_REQUIRED",recommendedAction:"Verify the supplied credentials."});
}
function authFailure<T>(error: { message?: string; status?: number } | null, code: string): RepositoryResult<T> {
  const authorization = error?.status === 401 || error?.status === 403;
  return repositoryFailure(authorization ? "REMOTE_AUTHORIZATION_DENIED" : code, authorization ? "Remote authentication or authorization was denied." : "Remote authentication transport failed.", {
    context: { provider: "supabase", status: error?.status }, recoverability: authorization ? "USER_ACTION_REQUIRED" : "RETRYABLE",
    recommendedAction: authorization ? "Verify credentials and application access." : "Retry after connectivity is restored.", cause: error,
  });
}
