import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Requests from "./pages/Requests";
import NewRequest from "./pages/NewRequest";
import RequestDetails from "./pages/RequestDetails";
import Approvals from "./pages/Approvals";
import ComingSoon from "./pages/ComingSoon";
import Login from "./pages/Login";
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
          <Route path="schedule" element={<ComingSoon title="Schedule" />} />
          <Route path="reports" element={<ComingSoon title="Reports" />} />
          <Route path="team" element={<ComingSoon title="Team" />} />
          <Route path="settings" element={<ComingSoon title="Settings" />} />
          <Route path="*" element={<ComingSoon title="Not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}
