"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHero, Modal, Card, CardSkeleton } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { SECTIONS } from "@/shared/constants/dashboardSections";

const S = SECTIONS.plans;

function fmtNum(n) {
  if (n == null) return "Unlimited";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}K`;
  return String(n);
}

function fmtPrice(cents) {
  if (!cents) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function daysLeft(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const d = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return `${d}d left`;
}

const STATUS_STYLE = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  cancelled: "bg-mm-surface text-steel border-hairline",
};

export default function PlansPageClient() {
  const notify = useNotificationStore();
  const [plans, setPlans] = useState([]);
  const [subs, setSubs] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestingPlan, setRequestingPlan] = useState(null);

  const fetchAll = useCallback(() => {
    return Promise.all([
      fetch("/api/subscription-plans").then((r) => (r.ok ? r.json() : { plans: [] })),
      fetch("/api/subscriptions").then((r) => (r.ok ? r.json() : { subscriptions: [] })),
      fetch("/api/keys").then((r) => (r.ok ? r.json() : { keys: [] })),
    ])
      .then(([p, s, k]) => {
        setPlans(p.plans || []);
        setSubs(s.subscriptions || []);
        setKeys(k.keys || []);
      })
      .catch((err) => console.log("Error loading plans:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCancel = async (sub) => {
    const res = await fetch(`/api/subscriptions/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    if (res.ok) {
      notify.success("Cancelled.");
      setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status: "cancelled" } : s)));
    } else {
      notify.error("Failed to cancel.");
    }
  };

  // Active subs are those with status='active' AND not expired. Render-time check
  // mirrors the server-side filter in getActiveSubscriptionsForKey. Date.now() is
  // intentional — the freshness window for expiry is a single render tick.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isLive = (s) =>
    s.status === "active" && (!s.expiresAt || new Date(s.expiresAt).getTime() > now);
  const liveSubs = subs.filter(isLive);
  const otherSubs = subs.filter((s) => !isLive(s));

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

      {/* Live subscriptions */}
      <Card section={S.color} className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="section-dot" />
          <h2 className="text-ink font-semibold tracking-tight">
            Active subscriptions {liveSubs.length > 0 && <span className="text-steel font-normal">({liveSubs.length})</span>}
          </h2>
        </div>
        {liveSubs.length === 0 ? (
          <p className="text-sm text-steel">No active subscriptions yet. Pick a plan below to get started.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {liveSubs.map((sub) => (
              <SubRow key={sub.id} sub={sub} keys={keys} onCancel={() => handleCancel(sub)} />
            ))}
          </div>
        )}
      </Card>

      {/* Plan catalog */}
      <Card section={S.color} className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="section-dot" />
          <h2 className="text-ink font-semibold tracking-tight">Available plans</h2>
        </div>
        {plans.length === 0 ? (
          <p className="text-sm text-steel">No plans available yet. Check back later.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {plans.map((plan) => (
              <CatalogCard key={plan.id} plan={plan} onRequest={() => setRequestingPlan(plan)} />
            ))}
          </div>
        )}
      </Card>

      {/* History */}
      {otherSubs.length > 0 && (
        <Card section={S.color} className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="section-dot" />
            <h2 className="text-ink font-semibold tracking-tight">History</h2>
          </div>
          <div className="flex flex-col gap-2">
            {otherSubs.map((sub) => (
              <HistoryRow key={sub.id} sub={sub} keys={keys} onCancel={() => handleCancel(sub)} />
            ))}
          </div>
        </Card>
      )}

      {requestingPlan && (
        <RequestModal
          plan={requestingPlan}
          keys={keys}
          onClose={() => setRequestingPlan(null)}
          onRequested={(sub) => {
            setRequestingPlan(null);
            setSubs((prev) => [sub, ...prev]);
            notify.success("Request submitted. Awaiting admin approval.");
          }}
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function CatalogCard({ plan, onRequest }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm font-semibold text-ink">{plan.name}</p>
          {plan.description && <p className="text-xs text-steel line-clamp-2">{plan.description}</p>}
        </div>
        {plan.stackable && (
          <span className="inline-flex items-center rounded-full bg-mm-surface px-2 py-0.5 text-[10px] font-semibold text-steel shrink-0">
            Stackable
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Tokens" value={fmtNum(plan.tokenBudget)} />
        <Stat label="Req/day" value={fmtNum(plan.requestsPerDay)} />
        <Stat label="Duration" value={`${plan.durationDays}d`} />
        <Stat label="Price" value={fmtPrice(plan.priceCents)} />
      </div>

      {plan.models?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plan.models.slice(0, 5).map((m) => (
            <span key={m} className="inline-flex items-center rounded-full bg-mm-surface px-2 py-0.5 font-mono text-[10px] text-steel">
              {m}
            </span>
          ))}
          {plan.models.length > 5 && (
            <span className="text-[10px] text-steel">+{plan.models.length - 5} more</span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onRequest}
        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-canvas hover:opacity-90"
      >
        <span className="material-symbols-outlined text-[16px]">shopping_cart_checkout</span>
        Request plan
      </button>
    </div>
  );
}

function SubRow({ sub, keys, onCancel }) {
  const keyName = keys.find((k) => k.id === sub.keyId)?.name || sub.keyId.slice(0, 8);
  const tokenPct = sub.tokenBudget
    ? Math.min(100, Math.round(((sub.usedTokens || 0) / sub.tokenBudget) * 100))
    : 0;
  const reqPct = sub.requestsPerDay
    ? Math.min(100, Math.round(((sub.usedRequestsToday || 0) / sub.requestsPerDay) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">
            Key: {keyName}{" "}
            {sub.expiresAt && <span className="text-steel font-normal text-xs ml-1">{daysLeft(sub.expiresAt)}</span>}
          </p>
          <p className="text-xs text-steel">{(sub.models || []).join(", ") || "no models"}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
        >
          Cancel
        </button>
      </div>

      {sub.tokenBudget != null && (
        <Bar
          label="Tokens"
          used={sub.usedTokens || 0}
          total={sub.tokenBudget}
          pct={tokenPct}
        />
      )}
      {sub.requestsPerDay != null && (
        <Bar
          label="Today's requests"
          used={sub.usedRequestsToday || 0}
          total={sub.requestsPerDay}
          pct={reqPct}
        />
      )}
    </div>
  );
}

function Bar({ label, used, total, pct }) {
  const danger = pct >= 100;
  const warn = pct >= 80 && !danger;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-steel">
        <span>{label}</span>
        <span className="font-mono">
          {used.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-mm-surface overflow-hidden">
        <div
          className={`h-full transition-all ${danger ? "bg-red-500" : warn ? "bg-amber-400" : "bg-ink"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function HistoryRow({ sub, keys, onCancel }) {
  const keyName = keys.find((k) => k.id === sub.keyId)?.name || sub.keyId.slice(0, 8);
  // eslint-disable-next-line react-hooks/purity
  const expired = sub.status === "active" && sub.expiresAt && new Date(sub.expiresAt).getTime() <= Date.now();
  const displayStatus = expired ? "cancelled" : sub.status;
  const statusLabel = expired ? "Expired" : sub.status;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${STATUS_STYLE[displayStatus] || STATUS_STYLE.cancelled}`}>
          {statusLabel}
        </span>
        <p className="text-xs text-steel truncate">
          {(sub.models || []).join(", ") || "—"} · key {keyName} · {sub.durationDays}d
        </p>
      </div>
      {sub.status === "pending" && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-steel hover:text-ink"
        >
          Cancel
        </button>
      )}
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

function RequestModal({ plan, keys, onClose, onRequested }) {
  const notify = useNotificationStore();
  const [keyId, setKeyId] = useState(keys[0]?.id || "");
  const [busy, setBusy] = useState(false);

  if (keys.length === 0) {
    return (
      <Modal isOpen onClose={onClose} title="No API keys">
        <p className="text-sm text-steel">
          You need at least one API key before requesting a plan. Create one on the My API Key page first.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full border border-hairline py-2 text-sm font-semibold"
        >
          Close
        </button>
      </Modal>
    );
  }

  const submit = async () => {
    if (!keyId) return notify.error("Pick a key.");
    setBusy(true);
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: plan.id, keyId }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      onRequested(data.subscription);
    } else {
      notify.error(data.error || "Failed to submit request.");
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Request: ${plan.name}`}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-hairline p-3 text-xs text-steel">
          <p>
            <strong className="text-ink">{fmtNum(plan.tokenBudget)}</strong> tokens ·{" "}
            <strong className="text-ink">{fmtNum(plan.requestsPerDay)}</strong> req/day ·{" "}
            <strong className="text-ink">{plan.durationDays}d</strong>
          </p>
          <p className="mt-1">An admin needs to approve before this becomes active.</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-steel">Attach to API key</span>
          <select
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm focus:outline-none focus:border-ink"
          >
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name || k.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded-full bg-ink py-2.5 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit request"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-hairline py-2.5 text-sm font-semibold text-steel hover:bg-mm-surface"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
