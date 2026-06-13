"use client";

import { useState, useEffect, useCallback } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";

const S = SECTIONS.users;

const ROLE_BADGE = {
  admin: "bg-ink text-canvas",
  user: "bg-mm-surface text-steel border border-hairline",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

function RoleBadge({ role }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${ROLE_BADGE[role] || ROLE_BADGE.user}`}>
      {role}
    </span>
  );
}

function StatusDot({ active }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-steel">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: active ? "var(--color-mm-success-text)" : "var(--color-stone)" }}
      />
      {active ? "Active" : "Disabled"}
    </span>
  );
}

// Small inline-confirm button: first click arms, second click within 3s fires.
function ConfirmButton({ label, icon, onConfirm, danger, busy }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        armed
          ? "bg-danger text-white"
          : danger
            ? "text-danger hover:bg-danger/10"
            : "text-steel hover:bg-mm-surface hover:text-ink"
      }`}
    >
      <span className="material-symbols-outlined text-[14px]">{armed ? "check" : icon}</span>
      {armed ? "Confirm" : label}
    </button>
  );
}

function CreateUserModal({ open, onClose, onCreated }) {
  const notify = useNotificationStore();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset transient form state when the modal opens. setState in an effect is
  // intentional here (the inputs are uncontrolled-from-props), so silence the
  // react-hooks/set-state-in-effect heuristic for this single line.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmail(""); setName(""); setPassword(""); setRole("user"); setError("");
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email)) return setError("Enter a valid email address.");
    if (password.length < MIN_PASSWORD_LEN) return setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);

    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined, password, role }),
      });
      const data = await res.json();
      if (res.ok) {
        notify.success(`Account created for ${data.user?.email || email}.`);
        onCreated();
        onClose();
      } else {
        setError(data.error || "Failed to create user.");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-[20px] border border-hairline bg-canvas p-6 shadow-[var(--shadow-elev)] sm:rounded-mm-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-ink">New account</h2>
          <button type="button" onClick={onClose} className="text-steel hover:text-ink" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Email">
            <input
              type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com" required
              className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-3 text-sm text-ink outline-none placeholder:text-stone focus:border-ink"
            />
          </Field>
          <Field label="Name" optional>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-3 text-sm text-ink outline-none placeholder:text-stone focus:border-ink"
            />
          </Field>
          <Field label="Password">
            <input
              type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters" required
              className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-3 text-sm text-ink outline-none placeholder:text-stone focus:border-ink"
            />
          </Field>
          <Field label="Role">
            <div className="flex gap-2">
              {["user", "admin"].map((r) => (
                <button
                  key={r} type="button" onClick={() => setRole(r)}
                  className={`flex-1 rounded-full border px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                    role === r ? "border-ink bg-ink text-canvas" : "border-hairline text-steel hover:border-ink hover:text-ink"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}

          <div className="mt-1 flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink hover:bg-mm-surface">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas hover:bg-charcoal disabled:opacity-50">
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, optional, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-charcoal">
        {label}{optional && <span className="ml-1 font-normal text-stone">(optional)</span>}
      </span>
      {children}
    </label>
  );
}

function UserActions({ user, currentUserId, onChanged }) {
  const notify = useNotificationStore();
  const [busy, setBusy] = useState(false);
  const isSelf = user.id === currentUserId;

  const patch = async (body, successMsg) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) { notify.success(successMsg); onChanged(); }
      else notify.error(data.error || "Update failed.");
    } catch { notify.error("An error occurred."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) { notify.success(`Deleted ${user.email}.`); onChanged(); }
      else notify.error(data.error || "Delete failed.");
    } catch { notify.error("An error occurred."); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {user.role === "admin" ? (
        <button type="button" disabled={busy || isSelf} title={isSelf ? "Can't change your own role" : "Demote to user"}
          onClick={() => patch({ role: "user" }, `${user.email} is now a user.`)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink disabled:opacity-40">
          <span className="material-symbols-outlined text-[14px]">arrow_downward</span>Demote
        </button>
      ) : (
        <button type="button" disabled={busy}
          onClick={() => patch({ role: "admin" }, `${user.email} is now an admin.`)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink disabled:opacity-40">
          <span className="material-symbols-outlined text-[14px]">arrow_upward</span>Promote
        </button>
      )}
      <button type="button" disabled={busy || isSelf} title={isSelf ? "Can't disable yourself" : ""}
        onClick={() => patch({ isActive: !user.isActive }, `${user.email} ${user.isActive ? "disabled" : "enabled"}.`)}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink disabled:opacity-40">
        <span className="material-symbols-outlined text-[14px]">{user.isActive ? "block" : "check_circle"}</span>
        {user.isActive ? "Disable" : "Enable"}
      </button>
      {!isSelf && <ConfirmButton label="Delete" icon="delete" danger busy={busy} onConfirm={remove} />}
    </div>
  );
}

export default function UsersPageClient() {
  const notify = useNotificationStore();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [allowSignup, setAllowSignup] = useState(true);
  const [signupBusy, setSignupBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [usersRes, statusRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/auth/status", { cache: "no-store" }),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
        setError("");
      } else {
        const data = await usersRes.json().catch(() => ({}));
        setError(data.error || "Failed to load users.");
      }
      if (statusRes.ok) {
        const s = await statusRes.json();
        setCurrentUserId(s.userId || null);
        setAllowSignup(s.allowSignup !== false);
      }
    } catch {
      setError("An error occurred while loading users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount. load() only calls setState inside async continuations, not
  // synchronously in the effect body, so the cascading-render concern doesn't
  // apply; silence the heuristic.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const toggleSignup = async () => {
    setSignupBusy(true);
    const next = !allowSignup;
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowSignup: next }),
      });
      if (res.ok) {
        setAllowSignup(next);
        notify.success(`Public sign-up ${next ? "enabled" : "disabled"}.`);
      } else {
        notify.error("Failed to update sign-up setting.");
      }
    } catch { notify.error("An error occurred."); }
    finally { setSignupBusy(false); }
  };

  const adminCount = users.filter((u) => u.role === "admin").length;
  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
        stats={[
          { label: "Total users", value: users.length },
          { label: "Admins", value: adminCount },
          { label: "Active", value: activeCount },
        ]}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-white/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New account
          </button>
        }
      />

      {/* Public sign-up control */}
      <div className="flex items-center justify-between gap-4 rounded-mm-xl border border-hairline bg-mm-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Public sign-up</p>
          <p className="text-xs text-steel">When off, only admins can create accounts (via this page or the CLI).</p>
        </div>
        <button
          type="button" role="switch" aria-checked={allowSignup} disabled={signupBusy}
          onClick={toggleSignup}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${allowSignup ? "bg-ink" : "bg-hairline"}`}
        >
          <span className={`mt-0.5 inline-block size-5 rounded-full bg-canvas transition-transform ${allowSignup ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-steel">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-hairline border-t-ink" />
          <span className="text-sm">Loading users…</span>
        </div>
      ) : error ? (
        <div className="rounded-mm-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-mm-xl border border-dashed border-hairline py-16 text-center">
          <span className="material-symbols-outlined text-[32px] text-stone">group_off</span>
          <div>
            <p className="text-sm font-semibold text-ink">No accounts yet</p>
            <p className="text-xs text-steel">Create the first account to get started.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-mm-xl border border-hairline md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mm-surface text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-hairline-soft last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{u.name || u.email.split("@")[0]}</p>
                      <p className="text-xs text-steel">{u.email}</p>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusDot active={u.isActive} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <UserActions user={u} currentUserId={currentUserId} onChanged={load} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {users.map((u) => (
              <div key={u.id} className="rounded-mm-xl border border-hairline bg-canvas p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{u.name || u.email.split("@")[0]}</p>
                    <p className="truncate text-xs text-steel">{u.email}</p>
                  </div>
                  <RoleBadge role={u.role} />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-hairline-soft pt-3">
                  <StatusDot active={u.isActive} />
                </div>
                <div className="mt-2">
                  <UserActions user={u} currentUserId={currentUserId} onChanged={load} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  );
}
