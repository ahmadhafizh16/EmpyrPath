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

// Admin quota editor for a single user's API key. Reads live usage from
// /api/keys/[id]/usage, writes config via PATCH /api/keys/[id]/quota.
function QuotaModal({ open, apiKey, userEmail, onClose, onSaved }) {
  const notify = useNotificationStore();
  const [metric, setMetric] = useState("requests");
  const [window, setWindow] = useState("day");
  const [limit, setLimit] = useState("");
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);

  // Seed the form from the key's current quota, and pull live counters. Only
  // fires when the modal opens for a key. The seed setState is synchronous;
  // silence the heuristic — the inputs are uncontrolled-from-props.
  useEffect(() => {
    if (!open || !apiKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetric(apiKey.quotaMetric || "requests");
    setWindow(apiKey.quotaWindow || "day");
    setLimit(apiKey.quotaLimit != null ? String(apiKey.quotaLimit) : "");
    setUsage(null);
    fetch(`/api/keys/${apiKey.id}/usage`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data?.counters || null))
      .catch(() => {});
  }, [open, apiKey]);

  if (!open || !apiKey) return null;

  const save = async (clear) => {
    setBusy(true);
    const body = clear
      ? { clear: true, resetUsage: true }
      : { quotaMetric: metric, quotaWindow: window, quotaLimit: Number(limit) };
    try {
      const res = await fetch(`/api/keys/${apiKey.id}/quota`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        notify.success(clear ? "Quota removed." : "Quota updated.");
        onSaved(data.key);
        onClose();
      } else {
        notify.error(data.error || "Failed to update quota.");
      }
    } catch {
      notify.error("An error occurred.");
    } finally {
      setBusy(false);
    }
  };

  const period = usage ? (window === "day" ? usage.day : usage.total) : null;
  const used = period ? (metric === "tokens" ? period.tokens : period.requests) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-[20px] border border-hairline bg-canvas p-6 shadow-[var(--shadow-elev)] sm:rounded-mm-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Usage quota</h2>
            <p className="text-xs text-steel">{userEmail}</p>
          </div>
          <button type="button" onClick={onClose} className="text-steel hover:text-ink" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Metric">
            <div className="flex gap-2">
              {["requests", "tokens"].map((m) => (
                <button key={m} type="button" onClick={() => setMetric(m)}
                  className={`flex-1 rounded-full border px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                    metric === m ? "border-ink bg-ink text-canvas" : "border-hairline text-steel hover:border-ink hover:text-ink"
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Window">
            <div className="flex gap-2">
              {[["day", "Per day"], ["total", "Total"]].map(([w, label]) => (
                <button key={w} type="button" onClick={() => setWindow(w)}
                  className={`flex-1 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    window === w ? "border-ink bg-ink text-canvas" : "border-hairline text-steel hover:border-ink hover:text-ink"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Limit">
            <input type="number" min="1" value={limit} onChange={(e) => setLimit(e.target.value)}
              placeholder={`Max ${metric} per ${window}`}
              className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-3 text-sm text-ink outline-none placeholder:text-stone focus:border-ink" />
          </Field>

          {used != null && (
            <p className="rounded-xl border border-hairline bg-mm-surface px-3 py-2 text-xs text-steel">
              Current usage: <span className="font-semibold text-ink">{used.toLocaleString()}</span> {metric} ({window})
            </p>
          )}

          <div className="mt-1 flex gap-2">
            {apiKey.quotaMetric && (
              <button type="button" disabled={busy} onClick={() => save(true)}
                className="rounded-full border border-hairline px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50">
                Remove
              </button>
            )}
            <button type="button" onClick={onClose} className="flex-1 rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink hover:bg-mm-surface">
              Cancel
            </button>
            <button type="button" disabled={busy || !limit || Number(limit) <= 0} onClick={() => save(false)}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas hover:bg-charcoal disabled:opacity-50">
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Admin allowance editor for a single user's API key. Pulls the model catalog
// from /api/models and combos from /api/combos, lets the admin toggle either,
// writes the unified list via PATCH /api/keys/[id]/allowed-models. Empty
// selection = the key may call nothing (default-deny stance for users); admins
// can also clear the list to make the key unrestricted (admin-style).
function ModelsModal({ open, apiKey, userEmail, onClose, onSaved }) {
  const notify = useNotificationStore();
  const [models, setModels] = useState([]);
  const [combos, setCombos] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [restrict, setRestrict] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed from the key's current allowedModels and load both catalogs. The
  // seed setState is synchronous — silence the heuristic (uncontrolled-from-props).
  useEffect(() => {
    if (!open || !apiKey) return;
    const current = Array.isArray(apiKey.allowedModels) ? apiKey.allowedModels : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestrict(current != null);
    setSelected(new Set(current || []));
    setQuery("");
    Promise.all([
      fetch("/api/models", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/combos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([modelsData, combosData]) => {
        setModels(Array.isArray(modelsData?.models) ? modelsData.models : []);
        setCombos(Array.isArray(combosData?.combos) ? combosData.combos : []);
      })
      .catch(() => {});
  }, [open, apiKey]);

  if (!open || !apiKey) return null;

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    const body = restrict ? { models: [...selected] } : { clear: true };
    try {
      const res = await fetch(`/api/keys/${apiKey.id}/allowed-models`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        notify.success(restrict ? "Allowance updated." : "Restriction removed.");
        onSaved(data.key);
        onClose();
      } else {
        notify.error(data.error || "Failed to update allowance.");
      }
    } catch {
      notify.error("An error occurred.");
    } finally {
      setBusy(false);
    }
  };

  const q = query.toLowerCase();
  const filteredModels = q
    ? models.filter((m) => `${m.fullModel} ${m.alias || ""}`.toLowerCase().includes(q))
    : models;
  const filteredCombos = q
    ? combos.filter((c) => c.name.toLowerCase().includes(q))
    : combos;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-[20px] border border-hairline bg-canvas p-6 shadow-[var(--shadow-elev)] sm:rounded-mm-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Allowed models &amp; combos</h2>
            <p className="text-xs text-steel">{userEmail}</p>
          </div>
          <button type="button" onClick={onClose} className="text-steel hover:text-ink" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between gap-4 rounded-xl border border-hairline bg-mm-surface px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Restrict access</p>
            <p className="text-xs text-steel">Off = unrestricted (admin-style). On = only the selected models &amp; combos.</p>
          </div>
          <button
            type="button" role="switch" aria-checked={restrict}
            onClick={() => setRestrict((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${restrict ? "bg-ink" : "bg-hairline"}`}
          >
            <span className={`mt-0.5 inline-block size-5 rounded-full bg-canvas transition-transform ${restrict ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>

        {restrict && (
          <>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models or combos…"
              className="mb-2 h-10 w-full rounded-[10px] border border-hairline bg-canvas px-3 text-sm text-ink outline-none placeholder:text-stone focus:border-ink"
            />
            <p className="mb-2 text-xs text-steel">{selected.size} selected</p>
            <div className="flex-1 overflow-y-auto rounded-xl border border-hairline">
              {filteredCombos.length > 0 && (
                <>
                  <p className="sticky top-0 z-10 bg-mm-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    Combos
                  </p>
                  {filteredCombos.map((c) => {
                    const on = selected.has(c.name);
                    return (
                      <button
                        key={`combo:${c.id || c.name}`} type="button" onClick={() => toggle(c.name)}
                        className="flex w-full items-center justify-between gap-3 border-b border-hairline-soft px-3 py-2 text-left last:border-b-0 hover:bg-mm-surface"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{c.name}</span>
                          <span className="block truncate text-[11px] text-steel">combo · {c.kind || "fallback"}</span>
                        </span>
                        <span className={`material-symbols-outlined text-[18px] ${on ? "text-ink" : "text-stone"}`}>
                          {on ? "check_box" : "check_box_outline_blank"}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              {filteredModels.length > 0 && (
                <>
                  <p className="sticky top-0 z-10 bg-mm-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    Models
                  </p>
                  {filteredModels.map((m) => {
                    const on = selected.has(m.fullModel);
                    return (
                      <button
                        key={m.fullModel} type="button" onClick={() => toggle(m.fullModel)}
                        className="flex w-full items-center justify-between gap-3 border-b border-hairline-soft px-3 py-2 text-left last:border-b-0 hover:bg-mm-surface"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{m.alias || m.model}</span>
                          <span className="block truncate text-[11px] text-steel">{m.fullModel}</span>
                        </span>
                        <span className={`material-symbols-outlined text-[18px] ${on ? "text-ink" : "text-stone"}`}>
                          {on ? "check_box" : "check_box_outline_blank"}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              {filteredModels.length === 0 && filteredCombos.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-steel">Nothing matches.</p>
              )}
            </div>
          </>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink hover:bg-mm-surface">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={save}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas hover:bg-charcoal disabled:opacity-50">
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function UserActions({ user, currentUserId, apiKey, onChanged, onQuota, onModels }) {
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
      {user.role !== "admin" && apiKey && (
        <button type="button" disabled={busy} title={apiKey.quotaMetric ? `${apiKey.quotaLimit} ${apiKey.quotaMetric}/${apiKey.quotaWindow}` : "No quota set"}
          onClick={() => onQuota(user, apiKey)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink disabled:opacity-40">
          <span className="material-symbols-outlined text-[14px]">speed</span>
          {apiKey.quotaMetric ? "Quota set" : "Quota"}
        </button>
      )}
      {user.role !== "admin" && apiKey && (
        <button type="button" disabled={busy}
          title={Array.isArray(apiKey.allowedModels) ? `${apiKey.allowedModels.length} models allowed` : "No restriction"}
          onClick={() => onModels(user, apiKey)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink disabled:opacity-40">
          <span className="material-symbols-outlined text-[14px]">tune</span>
          {Array.isArray(apiKey.allowedModels) ? "Models set" : "Models"}
        </button>
      )}
      {!isSelf && <ConfirmButton label="Delete" icon="delete" danger busy={busy} onConfirm={remove} />}
    </div>
  );
}

export default function UsersPageClient() {
  const notify = useNotificationStore();
  const [users, setUsers] = useState([]);
  const [keysByUser, setKeysByUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [allowSignup, setAllowSignup] = useState(true);
  const [signupBusy, setSignupBusy] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState(null); // { user, apiKey }
  const [modelsTarget, setModelsTarget] = useState(null); // { user, apiKey }

  const load = useCallback(async () => {
    try {
      const [usersRes, statusRes, keysRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/auth/status", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
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
      // Map first key per user — PR1 mints exactly one default key per user,
      // so first-by-createdAt is "the user's key". When PR3 adds multi-key UI,
      // promote this to a list.
      if (keysRes.ok) {
        const data = await keysRes.json();
        const map = {};
        for (const k of (data.keys || [])) {
          if (k.userId && !map[k.userId]) map[k.userId] = k;
        }
        setKeysByUser(map);
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
                        <UserActions user={u} currentUserId={currentUserId} apiKey={keysByUser[u.id]} onChanged={load} onQuota={(user, key) => setQuotaTarget({ user, apiKey: key })} onModels={(user, key) => setModelsTarget({ user, apiKey: key })} />
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
                  <UserActions user={u} currentUserId={currentUserId} apiKey={keysByUser[u.id]} onChanged={load} onQuota={(user, key) => setQuotaTarget({ user, apiKey: key })} onModels={(user, key) => setModelsTarget({ user, apiKey: key })} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <QuotaModal
        open={!!quotaTarget}
        apiKey={quotaTarget?.apiKey}
        userEmail={quotaTarget?.user?.email}
        onClose={() => setQuotaTarget(null)}
        onSaved={() => load()}
      />
      <ModelsModal
        open={!!modelsTarget}
        apiKey={modelsTarget?.apiKey}
        userEmail={modelsTarget?.user?.email}
        onClose={() => setModelsTarget(null)}
        onSaved={() => load()}
      />
    </div>
  );
}
