import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useApplicationDependenciesCompatibility } from "@/app/composition";
import type { AuthSession } from "./domain/session";
import type { Permission } from "./domain/permission";
import type { LoginCredentials } from "./repository/AuthRepository";
import type { LoginResult } from "./services/AuthenticationService";
import type { AuthenticationRequest } from "./providers/AuthenticationProvider";
import { LOCAL_AUTH_PROVIDER_ID } from "./providers/local/LocalAuthenticationProvider";
import type { Role } from "./role";
import { AUTH_USERS_STORAGE_KEY } from "./repository/localStorageSchema";
import { subscribeCanonicalUserChanges } from "./services/canonicalUserChangeNotifications";
import { hasRecoveryCallback } from "./recovery";
import {
  adaptDomainUser,
  adaptLegacyUser,
  type AuthenticatedUser,
} from "./services/legacyAuthCompatibility";

export interface AuthContextType {
  user: AuthenticatedUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isSubmitting: boolean;
  isLoggingOut: boolean;
  isRecoveryFlow: boolean;
  authenticate: (request: AuthenticationRequest) => Promise<LoginResult>;
  login: {
    (credentials: LoginCredentials): Promise<LoginResult>;
    /** @deprecated Legacy test/workflow adapter. Production UI must use credentials. */
    (name: string, role: Role): Promise<LoginResult>;
  };
  loginWithOperatorPin: (operatorCode: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
  hasPermission: (permission: Permission) => boolean;
  /** @deprecated Use session instead. Retained for legacy consumers during RBAC migration. */
  token: string | null;
  /** @deprecated Session restoration is automatic. Retained for isolated legacy tests. */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { authentication } = useApplicationDependenciesCompatibility();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [remotePermissions, setRemotePermissions] = useState<ReadonlySet<string> | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRecoveryFlow] = useState(() => hasRecoveryCallback());

  const refreshSession = useCallback(async () => {
    setIsInitializing(true);
    await Promise.resolve();
    if (authentication.remoteAuthenticationProvider) {
      const restored = await authentication.remoteAuthenticationProvider.restoreSession();
      if (restored.success && restored.value) {
        authentication.legacyCompatibilityRepository.clear();
        setUser(adaptDomainUser(restored.value.user));
        setSession(restored.value.session);
        setRemotePermissions(new Set(restored.value.permissions));
      } else {
        setUser(null);
        setSession(null);
        setRemotePermissions(null);
      }
      setIsInitializing(false);
      return;
    }
    const restored = authentication.authenticationService.initialize();
    if (restored.user && restored.session) {
      authentication.legacyCompatibilityRepository.clear();
      setUser(adaptDomainUser(restored.user));
      setSession(restored.session);
      setRemotePermissions(null);
    } else {
      const legacyUser =
        authentication.legacyCompatibilityRepository.getCurrentUser();
      setUser(legacyUser ? adaptLegacyUser(legacyUser) : null);
      setSession(null);
      setRemotePermissions(null);
    }
    setIsInitializing(false);
  }, [authentication]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const refreshCurrentUser = (changedUserId?: string) => {
      if (!user || (changedUserId && changedUserId !== user.id)) return;
      void refreshSession();
    };
    const unsubscribe = subscribeCanonicalUserChanges(refreshCurrentUser);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === AUTH_USERS_STORAGE_KEY) refreshCurrentUser();
    };
    window.addEventListener("storage", handleStorage);
    return () => { unsubscribe(); window.removeEventListener("storage", handleStorage); };
  }, [refreshSession, user]);

  const authenticate = useCallback(
    async (request: AuthenticationRequest): Promise<LoginResult> => {
      if (isSubmitting) {
        return {
          success: false,
          reason: "INVALID_CREDENTIALS",
          message: "A sign-in request is already in progress.",
        };
      }
      setIsSubmitting(true);
      setIsLoggingOut(false);
      try {
        await Promise.resolve();
        if (authentication.remoteAuthenticationProvider) {
          const payload = request.payload as Partial<LoginCredentials>;
          if (typeof payload.username !== "string" || typeof payload.password !== "string") {
            return { success: false, reason: "INVALID_CREDENTIALS", message: "Enter a valid email and password." };
          }
          const remote = await authentication.remoteAuthenticationProvider.login({ username: payload.username, password: payload.password });
          if (!remote.success) return { success: false, reason: "INVALID_CREDENTIALS", message: "Invalid username/email or password." };
          authentication.legacyCompatibilityRepository.clear();
          setUser(adaptDomainUser(remote.value.user));
          setSession(remote.value.session);
          setRemotePermissions(new Set(remote.value.permissions));
          return { success: true, session: remote.value.session, user: remote.value.user };
        }
        const result = authentication.authenticationService.login(request);
        if (result.success) {
          authentication.legacyCompatibilityRepository.clear();
          setUser(adaptDomainUser(result.user));
          setSession(result.session);
          setRemotePermissions(null);
        }
        return result;
      } finally {
        setIsSubmitting(false);
      }
    },
    [authentication, isSubmitting],
  );

  const login = useCallback(
    async (credentialsOrName: LoginCredentials | string, legacyRole?: Role): Promise<LoginResult> => {
      if (typeof credentialsOrName === "string") {
        const legacy = authentication.legacyCompatibilityRepository.login(
          credentialsOrName,
          legacyRole ?? "Operator",
        );
        const adapted = adaptLegacyUser(legacy);
        const compatibilitySession: AuthSession = {
          id: crypto.randomUUID(),
          userId: adapted.id,
          providerId: "legacy-local-compatibility",
          createdAt: new Date().toISOString(),
        };
        setUser(adapted);
        setSession(compatibilitySession);
        setRemotePermissions(null);
        return {
          success: true,
          session: compatibilitySession,
          user: adapted,
        };
      }
      return authenticate({
        providerId: authentication.remoteAuthenticationProvider?.id ?? LOCAL_AUTH_PROVIDER_ID,
        payload: credentialsOrName,
      });
    },
    [authenticate, authentication],
  );

  const logout = useCallback(() => {
    setIsLoggingOut(true);
    if (authentication.remoteAuthenticationProvider) void authentication.remoteAuthenticationProvider.logout();
    else authentication.authenticationService.logout();
    authentication.legacyCompatibilityRepository.clear();
    setUser(null);
    setSession(null);
    setRemotePermissions(null);
  }, [authentication]);

  const loginWithOperatorPin = useCallback(async (operatorCode: string, pin: string): Promise<LoginResult> => {
    const service = authentication.operatorPinCredentialService;
    if (!service) return { success: false, reason: "PROVIDER_UNAVAILABLE", message: "Operator PIN authentication is unavailable." };
    const result = await service.authenticate(operatorCode, pin);
    if (!result.success) return { success: false, reason: result.reason === "INACTIVE_USER" ? "INACTIVE_USER" : "INVALID_CREDENTIALS", message: result.message };
    authentication.legacyCompatibilityRepository.clear();
    const adapted = adaptDomainUser(result.user);
    setUser(adapted);
    setSession(result.session);
    setRemotePermissions(null);
    return { success: true, session: result.session, user: result.user };
  }, [authentication]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      isAuthenticated: user !== null,
      isInitializing,
      isSubmitting,
      isLoggingOut,
      isRecoveryFlow,
      authenticate,
      login,
      loginWithOperatorPin,
      logout,
      hasPermission: (permission) =>
        (!user && import.meta.env.MODE === "test") ||
        (remotePermissions
          ? authentication.authorizationService.hasGrantedPermission(user, permission, remotePermissions)
          : authentication.authorizationService.hasPermission(user, permission)),
      token: session?.id ?? null,
      refreshSession,
    }),
    [authenticate, authentication, isInitializing, isLoggingOut, isRecoveryFlow, isSubmitting, login, loginWithOperatorPin, logout, refreshSession, remotePermissions, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

/** Allows reusable Settings sections to render in isolation. */
export function useOptionalAuth(): AuthContextType | undefined {
  return useContext(AuthContext);
}
