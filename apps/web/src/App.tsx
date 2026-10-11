import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/session";
import {
  AuthLayout,
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
} from "./pages/AuthPages";
import { ProtectedLayout, AdminGuard } from "./components/Shell";
import {
  ResourcePage,
  materialDefinition,
  standardDefinition,
  farmDefinition,
  zoneDefinition,
  treeDefinition,
  harvestDefinition,
} from "./pages/Resources";
import {
  CooperativeList,
  CooperativeDetailPage,
  CooperativeEditor,
} from "./pages/Cooperatives";
import { PendingManagersPage } from "./pages/ManagerApproval";
import { Dashboard } from "./pages/Dashboards";
import { IotPage } from "./pages/Iot";
import {
  actuatorDefinition,
  deviceDefinition,
  sensorDefinition,
} from "./pages/IotResources";
import { TraceabilityPage } from "./pages/Traceability";
import { RequestsPage } from "./pages/Requests";
import { AccountPage } from "./pages/Account";
import { CooperativeUpdatesPage } from "./pages/CooperativeUpdates";
import { CultivationPage, JournalDetailPage } from "./pages/Cultivation";
import { HarvestBackdatesPage } from "./pages/HarvestBackdates";
import {
  AssignmentsPage,
  FarmNotificationsPage,
  MembershipPage,
} from "./pages/FarmWorkflows";
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/trace/:treeCode" element={<TraceabilityPage />} />
        <Route
          path="/*"
          element={
            <AuthProvider>
              <SessionRoutes />
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function SessionRoutes() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route element={<ProtectedLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route
          path="cooperative-updates"
          element={<CooperativeUpdatesPage />}
        />
        <Route path="cultivation-events" element={<CultivationPage />} />
        <Route path="cultivation-events/:id" element={<JournalDetailPage />} />
        <Route path="harvest-backdates" element={<HarvestBackdatesPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="farm-notifications" element={<FarmNotificationsPage />} />
        <Route path="farms/:id/membership" element={<MembershipPage />} />
        <Route
          path="materials"
          element={<ResourcePage definition={materialDefinition} />}
        />
        <Route
          path="materials/:id"
          element={<ResourcePage definition={materialDefinition} />}
        />
        <Route
          path="standards"
          element={<ResourcePage definition={standardDefinition} />}
        />
        <Route
          path="standards/:id"
          element={<ResourcePage definition={standardDefinition} />}
        />
        <Route
          path="farms"
          element={<ResourcePage definition={farmDefinition} />}
        />
        <Route
          path="farms/:id"
          element={<ResourcePage definition={farmDefinition} />}
        />
        <Route
          path="zones"
          element={<ResourcePage definition={zoneDefinition} />}
        />
        <Route
          path="zones/:id"
          element={<ResourcePage definition={zoneDefinition} />}
        />
        <Route
          path="trees"
          element={<ResourcePage definition={treeDefinition} />}
        />
        <Route
          path="trees/:id"
          element={<ResourcePage definition={treeDefinition} />}
        />
        <Route
          path="tree-harvests"
          element={<ResourcePage definition={harvestDefinition} />}
        />
        <Route
          path="tree-harvests/:id"
          element={<ResourcePage definition={harvestDefinition} />}
        />
        <Route path="cooperatives" element={<CooperativeList />} />
        <Route path="cooperatives/:id" element={<CooperativeDetailPage />} />
        <Route path="iot" element={<IotPage />} />
        <Route
          path="devices"
          element={<ResourcePage definition={deviceDefinition} />}
        />
        <Route
          path="devices/:id"
          element={<ResourcePage definition={deviceDefinition} />}
        />
        <Route
          path="sensors"
          element={<ResourcePage definition={sensorDefinition} />}
        />
        <Route
          path="sensors/:id"
          element={<ResourcePage definition={sensorDefinition} />}
        />
        <Route
          path="actuators"
          element={<ResourcePage definition={actuatorDefinition} />}
        />
        <Route
          path="actuators/:id"
          element={<ResourcePage definition={actuatorDefinition} />}
        />
        <Route element={<AdminGuard />}>
          <Route path="cooperatives/new" element={<CooperativeEditor />} />
          <Route path="cooperatives/:id/edit" element={<CooperativeEditor />} />
          <Route path="pending-managers" element={<PendingManagersPage />} />
        </Route>
        <Route
          path="*"
          element={
            <div className="panel">
              <h1>Không tìm thấy trang</h1>
              <Link to="/">Về tổng quan</Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
