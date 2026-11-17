import { useState, type FormEvent } from "react";
import { Topbar } from "../components/Layout";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../api/client";
import { MAX_DISPLAY_NAME, updateMe } from "../api/me";

/** TASK 13: your name and your notification preference. Email delivery itself is switched on by the platform. */
export default function Settings() {
  const { profile, reloadProfile, signOut } = useAuth();
  const [name, setName] = useState(profile?.displayName ?? "");
  const [email, setEmail] = useState(profile?.notificationPrefs?.email ?? true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (!profile) return null;

  const dirty = name.trim() !== profile.displayName || email !== (profile.notificationPrefs?.email ?? true);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNotice({ kind: "error", text: "Your name cannot be empty." });
    setBusy(true);
    setNotice(null);
    try {
      await updateMe({
        ...(trimmed !== profile.displayName ? { displayName: trimmed } : {}),
        ...(email !== (profile.notificationPrefs?.email ?? true) ? { notificationPrefs: { email } } : {}),
      });
      await reloadProfile();
      setNotice({ kind: "success", text: "Your settings were saved." });
    } catch (ex) {
      setNotice({ kind: "error", text: errorMessage(ex) });
    } finally {
      setBusy(false);
    }
  };

  const roles = profile.roles.map((r) => (r === "PlatformAdmin" ? "Platform administrator" : r === "ApprovalEligible" ? "Can be assigned as an approver" : r));
  return (
    <>
      <Topbar title="Settings" subtitle="Your profile and notifications." />
      <form className="card" onSubmit={save} noValidate aria-busy={busy} style={{ maxWidth: 640 }}>
        <div className="field">
          <label htmlFor="set-name">Name</label>
          <input id="set-name" className="input" value={name} maxLength={MAX_DISPLAY_NAME} disabled={busy} onChange={(e) => setName(e.target.value)} />
          <small className="cell-sub">Shown to other people on requests. Past records keep the name used at the time.</small>
        </div>
        <div className="field">
          <label htmlFor="set-email">Email</label>
          <input id="set-email" className="input" value={profile.email} readOnly aria-readonly="true" />
          <small className="cell-sub">Your sign-in address. It is never shown to other people.</small>
        </div>
        <div className="field">
          <label>Access</label>
          <p className="cell-sub">{roles.length ? roles.join(", ") : "Standard user. Your role on each request depends on the request."}</p>
        </div>
        <div className="field">
          <label htmlFor="set-notify" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="set-notify" type="checkbox" checked={email} disabled={busy} onChange={(e) => setEmail(e.target.checked)} />
            Send me email notifications
          </label>
          <small className="cell-sub">In-app notifications always appear in the bell. Email is sent only when the platform has email turned on.</small>
        </div>
        {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={`notice ${notice.kind}`}><span>{notice.text}</span></div>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={signOut} disabled={busy}>Sign out</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </>
  );
}
