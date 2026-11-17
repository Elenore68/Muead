import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Requests from "./pages/Requests";
import NewRequest from "./pages/NewRequest";
import RequestDetails from "./pages/RequestDetails";
import Approvals from "./pages/Approvals";
import ComingSoon from "./pages/ComingSoon";
import Login from "./pages/Login";
import Schedule from "./pages/Schedule";
import Reports from "./pages/Reports";
import Team from "./pages/Team";
import Settings from "./pages/Settings";
import { config } from "./config";
import RequireAuth from "./auth/RequireAuth";

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="requests" element={<Requests />} />
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="requests/:id" element={<RequestDetails />} />
          <Route path="approvals" element={<Approvals />} />
          {/* TASK 12: the Schedule page exists in live mode only; mock mode keeps the original placeholder. */}
          <Route path="schedule" element={config.apiEnabled ? <Schedule /> : <ComingSoon title="Schedule" />} />
          <Route path="reports" element={config.apiEnabled ? <Reports /> : <ComingSoon title="Reports" />} />
          <Route path="team" element={config.apiEnabled ? <Team /> : <ComingSoon title="Team" />} />
          <Route path="settings" element={config.apiEnabled ? <Settings /> : <ComingSoon title="Settings" />} />
          <Route path="*" element={<ComingSoon title="Not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}
