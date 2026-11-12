import { Navigate, Outlet, useLocation } from "react-router-dom";
import { config } from "../config";
import { useAuth } from "./AuthContext";

/** In mock mode everything is open (original behaviour). With the API enabled, a session is required. */
export default function RequireAuth() {
  const { status, error, retry, signOut } = useAuth();
  const loc = useLocation();
  if (!config.apiEnabled) return <Outlet />;

  if (status === "loading") {
    return <div className="auth-wrap"><p role="status" className="page-sub">Loading…</p></div>;
  }
  if (status === "error") {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <p role="alert" className="notice error">{error || "Could not load your profile."}</p>
          <div className="form-actions" style={{ justifyContent: "center" }}>
            <button className="btn btn-outline" onClick={signOut}>Sign out</button>
            <button className="btn btn-primary" onClick={retry}>Try again</button>
          </div>
        </div>
      </div>
    );
  }
  if (status === "signedOut") return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}
