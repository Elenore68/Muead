import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthenticationDetails, CognitoUser, CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js";
import { config } from "../config";
import { api, configureClient, errorMessage } from "../api/client";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  roles: string[];
}

type Status = "loading" | "signedOut" | "signedIn" | "error";
export type SignInResult = "ok" | "newPasswordRequired";

interface AuthValue {
  status: Status;
  profile: Profile | null;
  error: string;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  signOut: () => void;
  retry: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

// Created only when the API is configured (mock mode never touches Cognito).
const pool = config.apiEnabled ? new CognitoUserPool({ UserPoolId: config.userPoolId, ClientId: config.clientId }) : null;

const friendly = (err: any): string => {
  switch (err?.code ?? err?.name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "PasswordResetRequiredException":
      return "A password reset is required. Contact your administrator.";
    case "UserNotConfirmedException":
      return "Your account is not active yet. Contact your administrator.";
    case "InvalidPasswordException":
    case "InvalidParameterException":
      return err?.message ?? "That password does not meet the requirements.";
    case "TooManyRequestsException":
    case "LimitExceededException":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "NetworkError":
      return "Cannot reach the sign-in service. Check your connection.";
    default:
      return "Sign-in failed. Please try again.";
  }
};

/** Resolves a valid ID token; the library refreshes it with the refresh token when needed. */
const currentIdToken = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const user = pool?.getCurrentUser();
    if (!user) return reject(new Error("Not signed in"));
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return reject(err ?? new Error("Session expired"));
      resolve(session.getIdToken().getJwtToken());
    });
  });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(config.apiEnabled ? "loading" : "signedOut");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<CognitoUser | null>(null); // user waiting for a new password

  const signOut = useCallback(() => {
    pool?.getCurrentUser()?.signOut();
    pending.current = null;
    setProfile(null);
    setError("");
    setStatus("signedOut");
  }, []);

  /** Loads (and, on first login, creates) the profile through GET /me. */
  const loadProfile = useCallback(async () => {
    try {
      const me = await api<Profile>("me");
      setProfile(me);
      setError("");
      setStatus("signedIn");
    } catch (e) {
      // 401 already triggered signOut through the client; anything else is a recoverable error screen.
      if ((e as { status?: number }).status === 401) return;
      setError(errorMessage(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!config.apiEnabled) return;
    configureClient({ getToken: currentIdToken, onUnauthorized: signOut });
    currentIdToken().then(loadProfile, () => setStatus("signedOut"));
  }, [loadProfile, signOut]);

  const signIn = useCallback(
    (email: string, password: string) =>
      new Promise<SignInResult>((resolve, reject) => {
        if (!pool) return reject(new Error("Authentication is not configured"));
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        user.authenticateUser(new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password }), {
          onSuccess: () => {
            setStatus("loading");
            loadProfile().then(() => resolve("ok"));
          },
          // Administrator-created users must choose a new password on first sign-in.
          newPasswordRequired: () => {
            pending.current = user;
            resolve("newPasswordRequired");
          },
          // Not supported yet: the sign-in screen has no code entry step.
          totpRequired: () => reject(new Error("This account uses multi-factor authentication, which is not supported in the app yet.")),
          mfaRequired: () => reject(new Error("This account uses multi-factor authentication, which is not supported in the app yet.")),
          onFailure: (err) => reject(new Error(friendly(err))),
        });
      }),
    [loadProfile],
  );

  const completeNewPassword = useCallback(
    (newPassword: string) =>
      new Promise<void>((resolve, reject) => {
        const user = pending.current;
        if (!user) return reject(new Error("Your sign-in expired. Please start again."));
        user.completeNewPasswordChallenge(
          newPassword,
          {},
          {
            onSuccess: () => {
              pending.current = null;
              setStatus("loading");
              loadProfile().then(() => resolve());
            },
            onFailure: (err) => reject(new Error(friendly(err))),
          },
        );
      }),
    [loadProfile],
  );

  const retry = useCallback(() => {
    setStatus("loading");
    loadProfile();
  }, [loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({ status, profile, error, signIn, completeNewPassword, signOut, retry }),
    [status, profile, error, signIn, completeNewPassword, signOut, retry],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = (): AuthValue => {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
};
