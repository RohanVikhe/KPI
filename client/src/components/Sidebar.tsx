import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";

type NavItem = {
  label: string;
  to: string;
  roles?: string[];
  end?: boolean;
};

const navItems: NavItem[] = [
  { label: "Dashboard", to: "/", end: true },
  { label: "My Submissions", to: "/submissions", end: true },
  { label: "New Entry", to: "/submissions/new" },
  { label: "Analytics", to: "/analytics" },
  { label: "Profile", to: "/profile" },
  { label: "User Access", to: "/users", roles: ["ADMIN", "MANAGER"] },
  { label: "Team Pulse", to: "/team", roles: ["MANAGER", "ADMIN"] },
  { label: "Templates", to: "/templates", roles: ["ADMIN"] },
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">K</div>
        <div>
          <div className="brand-title">KPI Pulse</div>
          <div className="brand-sub">Performance Intelligence</div>
        </div>
      </div>

      <nav className="nav">
        {navItems
          .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="user-avatar">{user?.name?.slice(0, 1) ?? "U"}</div>
          <div>
            <div className="user-name">{user?.name ?? "User"}</div>
            <div className="user-role">{user?.role ?? ""}</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
