import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

/** Minimal sign-in screen built from existing design tokens (the reference has no login design). */
export default function Login() {
  const { status, signIn, completeNewPassword } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [step, setStep] = useState<"credentials" | "newPassword">("credentials");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (status === "signedIn") return <Navigate to={from} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCredentials = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    if (!email || !password) return setErr("Enter your email and password.");
    run(async () => {
      const r = await signIn(email, password);
      if (r === "newPasswordRequired") setStep("newPassword");
      else nav(from, { replace: true });
    });
  };

  const onNewPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pw = String(f.get("newPassword") ?? "");
    if (pw !== String(f.get("confirm") ?? "")) return setErr("The passwords do not match.");
    if (pw.length < 12) return setErr("Use at least 12 characters, with upper and lower case letters, a number and a symbol.");
    run(async () => {
      await completeNewPassword(pw);
      nav(from, { replace: true });
    });
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="logo">
          <LogoMark />
          <span className="logo-word">Mue'ad</span>
          <span className="logo-ar" lang="ar">ميعاد</span>
        </div>
        {step === "credentials" ? (
          <form onSubmit={onCredentials} noValidate aria-busy={busy}>
            <h1 className="card-title" style={{ justifyContent: "center", marginBottom: 16 }}>Sign in</h1>
            <div className="field"><label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" className="input" required /></div>
            <div className="field"><label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" className="input" required /></div>
            {err && <p role="alert" className="notice error">{err}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        ) : (
          <form onSubmit={onNewPassword} noValidate aria-busy={busy}>
            <h1 className="card-title" style={{ justifyContent: "center", marginBottom: 8 }}>Choose a new password</h1>
            <p className="page-sub" style={{ marginBottom: 16, textAlign: "center" }}>Your administrator gave you a temporary password. Set your own to continue.</p>
            <div className="field"><label htmlFor="newPassword">New password</label>
              <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" className="input" required /></div>
            <div className="field"><label htmlFor="confirm">Confirm new password</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" className="input" required /></div>
            {err && <p role="alert" className="notice error">{err}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
