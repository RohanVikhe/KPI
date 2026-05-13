import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth.tsx";
import AppShell from "./components/AppShell.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import NewSubmissionPage from "./pages/NewSubmissionPage.tsx";
import SubmissionsPage from "./pages/SubmissionsPage.tsx";
import SubmissionDetailPage from "./pages/SubmissionDetailPage.tsx";
import AnalyticsPage from "./pages/AnalyticsPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";
import TemplatesPage from "./pages/TemplatesPage.tsx";
import TeamPage from "./pages/TeamPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import type { Role } from "./lib/types.ts";

function getDefaultAuthenticatedPath(role?: Role) {
  return role === "ADMIN" ? "/analytics" : "/";
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactElement }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to={getDefaultAuthenticatedPath(user.role)} replace />;
  }

  return children;
}

function RequireNotRole({ roles, children }: { roles: string[]; children: ReactElement }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles.includes(user.role)) {
    return <Navigate to={getDefaultAuthenticatedPath(user.role)} replace />;
  }

  return children;
}

function HomePage() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "ADMIN") {
    return <Navigate to="/analytics" replace />;
  }

  return <DashboardPage />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route
          path="/submissions"
          element={
            <RequireNotRole roles={["ADMIN"]}>
              <SubmissionsPage />
            </RequireNotRole>
          }
        />
        <Route
          path="/submissions/new"
          element={
            <RequireNotRole roles={["ADMIN"]}>
              <NewSubmissionPage />
            </RequireNotRole>
          }
        />
        <Route path="/submissions/:id" element={<SubmissionDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/users"
          element={
            <RequireRole roles={["ADMIN", "MANAGER"]}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="/team"
          element={
            <RequireRole roles={["MANAGER", "ADMIN"]}>
              <TeamPage />
            </RequireRole>
          }
        />
        <Route
          path="/templates"
          element={
            <RequireRole roles={["ADMIN"]}>
              <TemplatesPage />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
