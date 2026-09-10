import type { RepositoryResult } from "@/core/persistence";
import type { RecoveryCallback } from "../recovery";
import type { AuthSession } from "../domain/session";
import type { User } from "../domain/user";

export interface RemoteAuthenticatedIdentity {
  session: AuthSession;
  user: User;
  permissions: readonly string[];
}
export interface RemoteAuthenticationProvider {
  readonly id: string;
  login(credentials: { username: string; password: string }): Promise<RepositoryResult<RemoteAuthenticatedIdentity>>;
  logout(): Promise<RepositoryResult<void>>;
  restoreSession(): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>>;
  refreshSession(): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>>;
  getCurrentUser(): Promise<RepositoryResult<User | null>>;
  updatePassword(password: string): Promise<RepositoryResult<void>>;
  establishRecoverySession(callback: RecoveryCallback): Promise<RepositoryResult<RemoteAuthenticatedIdentity | null>>;
}
