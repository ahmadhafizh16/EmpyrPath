"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHero, Card, Modal, ConfirmModal, CardSkeleton, ModelSelectModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { SECTIONS } from "@/shared/constants/dashboardSections";

const S = SECTIONS.subscriptions;

function fmtNum(n) {
  if (n == null) return "∞";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}K`;
  return String(n);
}

function fmtPrice(cents) {
  if (!cents) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

const EMPTY_FORM = {
  name: "",
  description: "",
  models: [],
  tokenBudget: "",
  requestsPerDay: "",
  durationDays: "30",
  priceCents: "0",
  stackable: false,
  isActive: true,
};

export default function SubscriptionsPageClient() {
  const notify = useNotificationStore();
  const [plans, setPlans] = useState([]);
  const [pending, setPending] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [keyMap, setKeyMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // plan being edited, or "new", or null
  const [confirmState, setConfirmState] = useState(null);

  const fetchAll = useCallback(() => {
    return Promise.all([
      fetch("/api/subscription-plans").then((r) => (r.ok ? r.json() : { plans: [] })),
      fetch("/api/subscriptions?status=pending").then((r) => (r.ok ? r.json() : { subscriptions: [] })),
      fetch("/api/providers").then((r) => (r.ok ? r.json() : { connections: [] })),
      fetch("/api/users").then((r) => (r.ok ? r.json() : { users: [] })),
      fetch("/api/keys").then((r) => (r.ok ? r.json() : { keys: [] })),
    ])
      .then(([p, s, prov, u, k]) => {
        setPlans(p.plans || []);
        setPending(s.subscriptions || []);
        // Filter to active connections — same shape ModelSelectModal expects
        // ({provider, ...}). Inactive accounts are hidden so the picker only
        // surfaces models the dashboard can actually call right now.
        setActiveProviders((prov.connections || []).filter((c) => c.isActive !== false));
        const um = {};
        for (const user of u.users || []) um[user.id] = user.email || user.name || user.id;
        setUserMap(um);
        const km = {};
        for (const key of k.keys || []) km[key.id] = key.name || key.id;
        setKeyMap(km);
      })
      .catch((err) => console.log("Error loading subscriptions:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleDeletePlan = (plan) => {
    setConfirmState({
      title: "Delete plan",
      message: `Delete "${plan.name}"? Existing subscriptions keep working; the plan just leaves the catalog.`,
      onConfirm: async () => {
        setConfirmState(null);
        const res = await fetch(`/api/subscription-plans/${plan.id}`, { method: "DELETE" });
        if (res.ok) {
          notify.success("Plan deleted.");
          setPlans((prev) => prev.filter((p) => p.id !== plan.id));
        } else {
          notify.error("Failed to delete plan.");
        }
      },
    });
  };

  const handleApprove = async (sub) => {
    const res = await fetch(`/api/subscriptions/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      notify.success("Subscription approved.");
      setPending((prev) => prev.filter((s) => s.id !== sub.id));
    } else if (data.error === "non_stackable_conflict") {
      notify.error("This key already has an active subscription and the plan is not stackable.");
    } else {
      notify.error(data.error || "Failed to approve.");
    }
  };

  const handleReject = async (sub) => {
    const res = await fetch(`/api/subscriptions/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    if (res.ok) {
      notify.success("Request rejected.");
      setPending((prev) => prev.filter((s) => s.id !== sub.id));
    } else {
      notify.error("Failed to reject.");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />

      {/* Pending approval queue */}
      <Card section={S.color} className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="section-dot" />
          <h2 className="text-ink font-semibold tracking-tight">
            Approval queue {pending.length > 0 && <span className="text-steel font-normal">({pending.length})</span>}
          </h2>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-steel">No pending requests.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-col gap-3 rounded-xl border border-hairline p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-ink">
                    {userMap[sub.userId] || sub.userId}
                    <span className="text-steel font-normal"> → key {keyMap[sub.keyId] || sub.keyId.slice(0, 8)}</span>
                  </p>
                  <p className="text-xs text-steel">
                    {(sub.models || []).join(", ") || "no models"} · {fmtNum(sub.tokenBudget)} tokens ·{" "}
                    {fmtNum(sub.requestsPerDay)} req/day · {sub.durationDays}d
                    {sub.stackable ? " · stackable" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(sub)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-canvas hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(sub)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Plan catalog */}
      <Card section={S.color} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="section-dot" />
            <h2 className="text-ink font-semibold tracking-tight">Plan catalog</h2>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-canvas hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Plan
          </button>
        </div>
        {plans.length === 0 ? (
          <p className="text-sm text-steel">No plans yet. Create one to populate the user catalog.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onEdit={() => setEditing(plan)}
                onDelete={() => handleDeletePlan(plan)}
              />
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <PlanFormModal
          plan={editing === "new" ? null : editing}
          activeProviders={activeProviders}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchAll();
          }}
        />
      )}

      {confirmState && (
        <ConfirmModal
          isOpen={!!confirmState}
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
          variant="danger"
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, onEdit, onDelete }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{plan.name}</p>
          {plan.description && <p className="text-xs text-steel line-clamp-2">{plan.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {plan.stackable && (
            <span className="inline-flex items-center rounded-full bg-mm-surface px-2 py-0.5 text-[10px] font-semibold text-steel">
              Stackable
            </span>
          )}
          {!plan.isActive && (
            <span className="inline-flex items-center rounded-full bg-mm-surface px-2 py-0.5 text-[10px] font-semibold text-steel">
              Hidden
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Tokens" value={fmtNum(plan.tokenBudget)} />
        <Stat label="Req/day" value={fmtNum(plan.requestsPerDay)} />
        <Stat label="Duration" value={`${plan.durationDays}d`} />
        <Stat label="Price" value={fmtPrice(plan.priceCents)} />
      </div>

      {plan.models?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plan.models.slice(0, 6).map((m) => (
            <span key={m} className="inline-flex items-center rounded-full bg-mm-surface px-2 py-0.5 font-mono text-[10px] text-steel">
              {m}
            </span>
          ))}
          {plan.models.length > 6 && (
            <span className="text-[10px] text-steel">+{plan.models.length - 6} more</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-semibold text-steel hover:bg-mm-surface hover:text-ink"
        >
          <span className="material-symbols-outlined text-[14px]">edit</span>
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
          Delete
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

function PlanFormModal({ plan, activeProviders, onClose, onSaved }) {
  const notify = useNotificationStore();
  const [form, setForm] = useState(() => plan ? {
    name: plan.name || "",
    description: plan.description || "",
    models: plan.models || [],
    tokenBudget: plan.tokenBudget == null ? "" : String(plan.tokenBudget),
    requestsPerDay: plan.requestsPerDay == null ? "" : String(plan.requestsPerDay),
    durationDays: String(plan.durationDays),
    priceCents: String(plan.priceCents || 0),
    stackable: !!plan.stackable,
    isActive: plan.isActive !== false,
  } : { ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  // Picker state — modelAliases drives custom-model display in ModelSelectModal,
  // matching the pattern ComboFormModal uses. Fetched on mount of the modal.
  const [showPicker, setShowPicker] = useState(false);
  const [modelAliases, setModelAliases] = useState({});

  useEffect(() => {
    fetch("/api/models/alias")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setModelAliases(d.aliases || {}))
      .catch(() => {});
  }, []);

  // Picker emits {value, name, ...} for both models (alias/id) and combos
  // (raw name). Both flow into form.models verbatim — checkApiKeyAccess matches
  // sub.models.includes(requestedModel) against the same string the request
  // arrives with, so picker value = enforcement key. closeOnSelect=false lets
  // the admin tick multiple items in one trip.
  const addItem = (m) => {
    const v = m?.value || m?.name;
    if (!v) return;
    setForm((f) => (f.models.includes(v) ? f : { ...f, models: [...f.models, v] }));
  };
  const removeItem = (v) => {
    setForm((f) => ({ ...f, models: f.models.filter((x) => x !== v) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return notify.error("Name is required.");
    if (!form.durationDays || Number(form.durationDays) <= 0) {
      return notify.error("Duration must be a positive number of days.");
    }

    setBusy(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      models: form.models,
      tokenBudget: form.tokenBudget === "" ? null : Number(form.tokenBudget),
      requestsPerDay: form.requestsPerDay === "" ? null : Number(form.requestsPerDay),
      durationDays: Number(form.durationDays),
      priceCents: Number(form.priceCents) || 0,
      stackable: form.stackable,
      isActive: form.isActive,
    };

    const url = plan ? `/api/subscription-plans/${plan.id}` : "/api/subscription-plans";
    const method = plan ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      notify.success(plan ? "Plan updated." : "Plan created.");
      onSaved();
    } else {
      const data = await res.json().catch(() => ({}));
      notify.error(data.error || "Failed to save plan.");
    }
  };

  return (
    <>
      <Modal isOpen onClose={onClose} title={plan ? "Edit Plan" : "Create Plan"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
            placeholder="Pro 30-day"
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
            rows={2}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Token budget (blank = unlimited)">
            <input
              type="number"
              min="0"
              value={form.tokenBudget}
              onChange={(e) => setForm((f) => ({ ...f, tokenBudget: e.target.value }))}
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
              placeholder="70000000"
            />
          </Field>
          <Field label="Requests/day (blank = unlimited)">
            <input
              type="number"
              min="0"
              value={form.requestsPerDay}
              onChange={(e) => setForm((f) => ({ ...f, requestsPerDay: e.target.value }))}
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
              placeholder="1000"
            />
          </Field>
          <Field label="Duration (days)">
            <input
              type="number"
              min="1"
              value={form.durationDays}
              onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
            />
          </Field>
          <Field label="Price (cents — display only)">
            <input
              type="number"
              min="0"
              value={form.priceCents}
              onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))}
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
            />
          </Field>
        </div>

        <Field label={`Models & Combos (${form.models.length} selected)`}>
          {form.models.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-xs text-steel">
              No models selected. Click below to add models or combos, grouped by provider.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {form.models.map((id) => (
                <span
                  key={id}
                  className="group inline-flex items-center gap-1 rounded-full border border-hairline bg-mm-surface pl-2.5 pr-1 py-1 font-mono text-[11px] text-ink"
                >
                  {id}
                  <button
                    type="button"
                    onClick={() => removeItem(id)}
                    className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-steel hover:bg-danger/10 hover:text-danger"
                    aria-label={`Remove ${id}`}
                  >
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-hairline px-3 py-2 text-xs font-semibold text-steel hover:border-ink hover:text-ink"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add models &amp; combos
          </button>
        </Field>

        <div className="flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.stackable}
              onChange={(e) => setForm((f) => ({ ...f, stackable: e.target.checked }))}
            />
            Stackable
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Visible to users
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-full bg-ink py-2.5 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : plan ? "Save Changes" : "Create Plan"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-hairline py-2.5 text-sm font-semibold text-steel hover:bg-mm-surface"
          >
            Cancel
          </button>
        </div>
      </form>
      </Modal>

      <ModelSelectModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={addItem}
        onDeselect={(m) => removeItem(m?.value || m?.name)}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={form.models}
        closeOnSelect={false}
        title="Add models & combos to plan"
      />
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-steel">{label}</span>
      {children}
    </label>
  );
}
