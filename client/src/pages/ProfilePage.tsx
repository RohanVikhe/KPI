import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { User } from "../lib/types.ts";
import MessageToast from "../components/MessageToast.tsx";

type ProfilePayload = {
  name: string;
  email: string;
  skills?: string;
};

type PasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

function formatValidationError(details: unknown) {
  if (!Array.isArray(details)) {
    return "";
  }
  const messages = details
    .map((issue) => {
      if (!issue || typeof issue !== "object") {
        return null;
      }
      const path = Array.isArray((issue as any).path) ? (issue as any).path.join(".") : "";
      const message = typeof (issue as any).message === "string" ? (issue as any).message : "Invalid value";
      return path ? `${path}: ${message}` : message;
    })
    .filter(Boolean);

  if (messages.length === 0) {
    return "";
  }
  return `Validation failed: ${messages.join("; ")}`;
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [profileForm, setProfileForm] = useState({ name: "", email: "", skills: "" });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (user) {
      setProfileForm({ name: user.name ?? "", email: user.email ?? "", skills: user.skills ?? "" });
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: (payload: ProfilePayload) =>
      apiFetch<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      updateUser(data.user);
      showToast("success", "Profile updated.");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const validation = formatValidationError(err.details);
        const message = validation || err.message || "Unable to update profile.";
        showToast("error", message);
        return;
      }
      showToast("error", "Unable to update profile.");
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: PasswordPayload) =>
      apiFetch<void>("/users/me/password", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast("success", "Password updated.");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const validation = formatValidationError(err.details);
        const message = validation || err.message || "Unable to update password.";
        showToast("error", message);
        return;
      }
      showToast("error", "Unable to update password.");
    },
  });

  const handleProfileSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = profileForm.name.trim();
    if (!name) {
      const message = "Name is required.";
      showToast("error", message);
      return;
    }

    const email = profileForm.email.trim().toLowerCase();
    if (!email) {
      const message = "Email is required.";
      showToast("error", message);
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      const message = "Please enter a valid email.";
      showToast("error", message);
      return;
    }

    const skills = profileForm.skills.trim();
    profileMutation.mutate({
      name,
      email,
      skills,
    });
  };

  const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      const message = "All password fields are required.";
      showToast("error", message);
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      const message = "New password must be at least 8 characters.";
      showToast("error", message);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      const message = "New password and confirmation do not match.";
      showToast("error", message);
      return;
    }

    passwordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  if (!user) {
    return <div className="panel">Loading profile...</div>;
  }

  return (
    <div className="page">
      {toast && (
        <MessageToast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      <form className="panel form" onSubmit={handleProfileSubmit}>
        <div className="panel-header">
          <h3>My Profile</h3>
          <span className="panel-sub">Update your personal details and skills.</span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Name</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Email</span>
            <input
              type="email"
              value={profileForm.email}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Role</span>
            <input value={user.role} readOnly />
          </label>
        </div>

        <label className="form-field">
          <span>Skills</span>
          <textarea
            value={profileForm.skills}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, skills: event.target.value }))}
            placeholder="Product strategy, SQL, stakeholder management"
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={profileMutation.isPending}>
          {profileMutation.isPending ? "Saving..." : "Save profile"}
        </button>
      </form>

      <form className="panel form" onSubmit={handlePasswordSubmit}>
        <div className="panel-header">
          <h3>Change Password</h3>
          <span className="panel-sub">Use at least 8 characters and avoid reusing old passwords.</span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Current Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>New Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordForm.newPassword}
              minLength={8}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Confirm New Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordForm.confirmPassword}
              minLength={8}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
            />
          </label>
        </div>

        <button className="btn btn-primary" type="submit" disabled={passwordMutation.isPending}>
          {passwordMutation.isPending ? "Updating..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
