import { useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/submissions": "My Submissions",
  "/submissions/new": "New KPI Entry",
  "/analytics": "Analytics",
  "/profile": "My Profile",
  "/users": "User Access",
  "/team": "Team Pulse",
  "/templates": "Templates",
};

export default function TopBar() {
  const location = useLocation();
  const { user } = useAuth();

  const title =
    location.pathname.startsWith("/submissions/") && location.pathname !== "/submissions"
      ? "Submission Detail"
      : pageTitles[location.pathname] ?? "KPI Pulse";

  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-subtitle">Track goals, measure growth, act fast.</div>
      </div>
      <div className="topbar-meta">
        <div className="status-pill">Live</div>
        <div className="user-meta">
          <div className="user-meta-name">{user?.name}</div>
          <div className="user-meta-role">{user?.role}</div>
        </div>
      </div>
    </header>
  );
}
