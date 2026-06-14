"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal, CardSkeleton, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Reduced endpoint surface for role=user. One "My API Key" card: endpoint URL,
// keys table (admin-style), per-key quota, plus the models and combos this user
// may call. Create/delete is gated on allowUserKeyGeneration (server enforces
// too). Keys are FE-masked but retrievable — no write-once modal.
export default function MyApiKeyPageClient() {
  const [keys, setKeys] = useState([]);
  const [models, setModels] = useState([]);
  const [combos, setCombos] = useState([]);
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [usageByKey, setUsageByKey] = useState({});
  const [allowKeyGen, setAllowKeyGen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleKeys, setVisibleKeys] = useState(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [confirmState, setConfirmState] = useState(null);
  const [baseUrl, setBaseUrl] = useState("/v1");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (typeof window !== "undefined")
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBaseUrl(`${window.location.origin}/v1`);
  }, []);

  const fetchAll = useCallback(() => {
    return Promise.all([
      fetch("/api/keys").then((r) => (r.ok ? r.json() : { keys: [] })),
      fetch("/api/models").then((r) => (r.ok ? r.json() : { models: [] })),
      fetch("/api/combos").then((r) => (r.ok ? r.json() : { combos: [] })),
      fetch("/api/auth/status").then((r) => (r.ok ? r.json() : {})),
      fetch("/api/subscriptions").then((r) =>
        r.ok ? r.json() : { subscriptions: [] },
      ),
      fetch("/api/subscription-plans").then((r) =>
        r.ok ? r.json() : { plans: [] },
      ),
    ])
      .then(
        ([keysData, modelsData, combosData, status, subsData, plansData]) => {
          const list = keysData.keys || [];
          setKeys(list);
          setModels(modelsData.models || []);
          setCombos(combosData.combos || []);
          setSubs(subsData.subscriptions || []);
          setPlans(plansData.plans || []);
          setAllowKeyGen(status?.allowUserKeyGeneration === true);
          // Pull per-key usage for any key with a quota — drives the bars.
          const quotaKeys = list.filter((k) => k.quotaMetric && k.quotaLimit);
          return Promise.all(
            quotaKeys.map((k) =>
              fetch(`/api/keys/${k.id}/usage`)
                .then((r) => (r.ok ? r.json() : null))
                .then((u) => ({ id: k.id, counters: u?.counters || null }))
                .catch(() => ({ id: k.id, counters: null })),
            ),
          ).then((results) => {
            const map = {};
            for (const r of results) if (r.counters) map[r.id] = r.counters;
            setUsageByKey(map);
          });
        },
      )
      .catch((err) => console.log("Error loading API key data:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Active subscriptions are the source of truth for what a user can call: the
  // 'active' predicate matches getActiveSubscriptionsForKey on the server so
  // access disappears at the same moment client-side even before a refetch.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const activeSubs = subs.filter(
    (s) =>
      s.status === "active" &&
      (!s.expiresAt || new Date(s.expiresAt).getTime() > nowMs),
  );
  const planNameById = plans.reduce((acc, p) => {
    acc[p.id] = p.name;
    return acc;
  }, {});

  // Effective allowance is the union of `models` arrays across active
  // subscriptions. The grant string is authoritative — enrich it with combo /
  // model metadata when we can resolve it, but NEVER drop an entry we can't
  // resolve. Synthetic suffix variants (`-thinking`/`-agentic`) or a raw model
  // id the admin typed won't appear in /api/models; show those as-is.
  const grantedList = [...new Set(activeSubs.flatMap((s) => s.models || []))];
  const grantedItems = grantedList.map((g) => {
    const combo = combos.find((c) => c.name === g);
    if (combo)
      return {
        key: combo.id || combo.name,
        label: combo.name,
        sub: "combo",
        accent: true,
      };
    const model = models.find(
      (m) => m.fullModel === g || m.alias === g || m.model === g,
    );
    if (model)
      return {
        key: model.fullModel,
        label: model.alias || model.model,
        sub: model.provider,
      };
    return { key: g, label: g, sub: null };
  });
  const nothingGranted = grantedItems.length === 0;

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      if (res.ok) {
        await fetchAll();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key? Requests using it will stop working.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys((prev) => prev.filter((k) => k.id !== id));
            setVisibleKeys((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      },
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok)
        setKeys((prev) =>
          prev.map((k) => (k.id === id ? { ...k, isActive } : k)),
        );
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const toggleKeyVisibility = (id) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div
      data-section="coral"
      className="rounded-hero bg-[#1c1c1c] border border-white/[0.06] p-7 sm:p-8 text-white flex flex-col gap-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="inline-flex items-center justify-center size-11 rounded-xl section-mark border border-white/20">
            <span className="material-symbols-outlined text-[22px]">
              vpn_key
            </span>
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">My API Key</h2>
            <p className="text-[13px] text-white/40 mt-0.5">
              Your endpoint, credentials, and usage limits
            </p>
          </div>
        </div>
        {allowKeyGen && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-white text-[#1c1c1c] hover:bg-white/90 px-4 py-2 text-[13px] font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Key
          </button>
        )}
      </div>

      {/* Endpoint URL */}
      <Section label="Endpoint URL" hint="Point your tools at this base URL">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-[10px] bg-white/5 border border-white/10 px-3 py-2.5 font-mono text-[13px] text-white/80 truncate">
            {baseUrl}
          </div>
          <IconBtn
            icon={copied === "url" ? "check" : "content_copy"}
            title="Copy URL"
            onClick={() => copy(baseUrl, "url")}
          />
        </div>
      </Section>

      {/* API Keys table */}
      <Section label="API Keys" hint="Authenticate requests with these keys">
        {keys.length === 0 ? (
          <EmptyHint
            icon="vpn_key_off"
            title="No API key yet"
            sub="Contact an admin if you need one issued."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <Th>Name</Th>
                  <Th>Token</Th>
                  <Th>Quota</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <KeyRow
                    key={key.id}
                    apiKey={key}
                    counters={usageByKey[key.id]}
                    visible={visibleKeys.has(key.id)}
                    copied={copied}
                    allowKeyGen={allowKeyGen}
                    onToggleVisibility={() => toggleKeyVisibility(key.id)}
                    onCopy={() => copy(key.key, key.id)}
                    onToggleActive={(next) => handleToggleKey(key.id, next)}
                    onDelete={() => handleDeleteKey(key.id)}
                    onConfirm={setConfirmState}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Active Subscription — current plan + tokens remaining only. */}
      {activeSubs.length > 0 && (
        <Section
          label="Active Subscription"
          hint="Your current plan and remaining token budget"
        >
          <div className="flex flex-col gap-3">
            {activeSubs.map((sub) => (
              <SubscriptionCard
                key={sub.id}
                planName={planNameById[sub.planId] || "Custom plan"}
                sub={sub}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Available models — models + combos granted by the active subscription. */}
      <Section
        label={`Available Models (${grantedItems.length})`}
        hint={
          nothingGranted
            ? "Subscribe to a plan to unlock model access"
            : "Models your subscription can call"
        }
      >
        {grantedItems.length === 0 ? (
          <p className="text-[12px] text-red-400/70">
            No models available. Subscribe to a plan to get access.
          </p>
        ) : (
          <ChipScroll>
            {grantedItems.map((item) => (
              <Chip key={item.key} label={item.label} />
            ))}
          </ChipScroll>
        )}
      </Section>

      {/* Create key modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="My Key"
            className="w-full py-2.5 px-3 text-sm text-[#f5f5f5] bg-[#1f1f1f] rounded-[10px] border border-white/10 placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors text-[16px] sm:text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreateKey}
              disabled={!newKeyName.trim()}
              className="flex-1 rounded-full bg-white text-[#1c1c1c] py-2.5 text-sm font-semibold hover:bg-white/90 disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              className="flex-1 rounded-full border border-white/15 text-white py-2.5 text-sm font-semibold hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

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

// ── presentational helpers ────────────────────────────────────────────────

function Section({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
          {label}
        </p>
        {hint && <p className="text-[12px] text-white/35 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function IconBtn({ icon, title, onClick, danger, small }) {
  const size = small ? "size-8" : "size-9";
  const iconSize = small ? "text-[16px]" : "text-[18px]";
  const palette = danger
    ? "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15"
    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`cursor-pointer inline-flex items-center justify-center ${size} rounded-[10px] border ${palette} transition-colors`}
    >
      <span className={`material-symbols-outlined ${iconSize}`}>{icon}</span>
    </button>
  );
}

function Th({ children, right }) {
  return (
    <th
      className={`text-${right ? "right" : "left"} text-[11px] font-semibold text-white/40 uppercase tracking-wider pb-3 ${right ? "" : "pr-4"}`}
    >
      {children}
    </th>
  );
}

function EmptyHint({ icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <span className="material-symbols-outlined text-[40px] text-white/15 mb-3">
        {icon}
      </span>
      <p className="text-white/70 font-medium mb-1">{title}</p>
      {sub && <p className="text-[13px] text-white/35">{sub}</p>}
    </div>
  );
}

function SubscriptionCard({ planName, sub }) {
  // Lifetime token budget is the headline metric. A null budget means the plan
  // grants unlimited tokens; render that explicitly rather than a 0/0 bar.
  const used = sub.usedTokens || 0;
  const total = sub.tokenBudget;
  const unlimited = total == null;
  const remaining = unlimited ? null : Math.max(0, total - used);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / total) * 100));
  const overLimit = !unlimited && used >= total;

  // Expiry. null expiresAt = no end date (open-ended grant). Format the absolute
  // date for clarity and add a relative "Nd left" so the user sees urgency.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const endDate = sub.expiresAt ? new Date(sub.expiresAt) : null;
  const daysLeft = endDate
    ? Math.ceil((endDate.getTime() - nowMs) / (24 * 60 * 60 * 1000))
    : null;
  const endLabel = endDate
    ? endDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "No expiry";
  const expiringSoon = daysLeft != null && daysLeft <= 3;

  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-white/40">
            workspace_premium
          </span>
          <p className="text-[13px] font-semibold text-white/90">{planName}</p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-[10px] font-semibold text-green-400">
          Active
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-white/50">Tokens remaining</span>
          <span
            className={
              overLimit
                ? "text-red-400 font-semibold"
                : "text-white/70 font-medium"
            }
          >
            {unlimited
              ? "Unlimited"
              : `${remaining.toLocaleString()} / ${total.toLocaleString()}`}
          </span>
        </div>
        {!unlimited && (
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full transition-all ${overLimit ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-white/40"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-white/[0.06]">
        <span className="text-white/50">
          <span className="material-symbols-outlined text-[14px] align-middle mr-1 text-white/35">
            event
          </span>
          {endDate ? "Ends" : "Expiry"}
        </span>
        <span className={expiringSoon ? "text-amber-400 font-semibold" : "text-white/70 font-medium"}>
          {endLabel}
          {daysLeft != null && (
            <span className="text-white/35 ml-1">
              ({daysLeft > 0 ? `${daysLeft}d left` : "expired"})
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function ChipScroll({ children }) {
  return (
    <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pr-1">
      {children}
    </div>
  );
}

function Chip({ label, sub, accent }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border ${
        accent
          ? "bg-brand-purple/15 border-brand-purple/25 text-white/85"
          : "bg-white/[0.05] border-white/[0.08] text-white/70"
      }`}
    >
      {label}
      {sub && <span className="text-white/30">· {sub}</span>}
    </span>
  );
}

function KeyRow({
  apiKey,
  counters,
  visible,
  copied,
  allowKeyGen,
  onToggleVisibility,
  onCopy,
  onToggleActive,
  onDelete,
  onConfirm,
}) {
  const hasQuota = apiKey.quotaMetric && apiKey.quotaLimit;
  const period =
    hasQuota && counters
      ? apiKey.quotaWindow === "day"
        ? counters.day
        : counters.total
      : null;
  const used = period
    ? apiKey.quotaMetric === "tokens"
      ? period.tokens
      : period.requests
    : null;
  const pct =
    used != null
      ? Math.min(100, Math.round((used / apiKey.quotaLimit) * 100))
      : null;
  const overLimit = used != null && used >= apiKey.quotaLimit;
  const isActive = apiKey.isActive ?? true;

  return (
    <tr
      className={`group border-b border-white/[0.04] last:border-b-0 ${isActive ? "" : "opacity-40"}`}
    >
      <td className="py-3.5 pr-4">
        <p className="text-[13px] font-semibold text-white/90">{apiKey.name}</p>
      </td>
      <td className="py-3.5 pr-4">
        <div className="flex items-center gap-2">
          <code className="text-[11px] text-white/35 font-mono select-all">
            {visible
              ? apiKey.key
              : apiKey.key.slice(0, 5) +
                "*".repeat(Math.max(0, apiKey.key.length - 5))}
          </code>
          <IconBtn
            icon={visible ? "visibility_off" : "visibility"}
            title={visible ? "Hide" : "Show"}
            onClick={onToggleVisibility}
            small
          />
          <IconBtn
            icon={copied === apiKey.id ? "check" : "content_copy"}
            title="Copy key"
            onClick={onCopy}
            small
          />
        </div>
      </td>
      <td className="py-3.5 pr-4">
        {hasQuota ? (
          <div className="flex flex-col gap-1.5 min-w-[160px]">
            <div className="flex items-center justify-between text-[11px]">
              <span
                className={
                  overLimit ? "text-red-400 font-semibold" : "text-white/60"
                }
              >
                {(used ?? 0).toLocaleString()} /{" "}
                {apiKey.quotaLimit.toLocaleString()}
                <span className="text-white/30 ml-1">
                  {apiKey.quotaMetric}/{apiKey.quotaWindow}
                </span>
              </span>
              {pct != null && (
                <span
                  className={
                    overLimit ? "text-red-400 font-semibold" : "text-white/40"
                  }
                >
                  {pct}%
                </span>
              )}
            </div>
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full transition-all ${overLimit ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-white/40"}`}
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-white/30">Unlimited</span>
        )}
      </td>
      <td className="py-3.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !isActive;
              if (isActive && !next) {
                onConfirm({
                  title: "Pause API Key",
                  message: `Pause "${apiKey.name}"? It will stop working but can be resumed.`,
                  onConfirm: async () => {
                    onConfirm(null);
                    onToggleActive(next);
                  },
                });
              } else {
                onToggleActive(next);
              }
            }}
            className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
              isActive
                ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/15"
                : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
            }`}
            title={isActive ? "Pause key" : "Resume key"}
          >
            <span className="material-symbols-outlined text-[14px]">
              {isActive ? "play_circle" : "pause_circle"}
            </span>
            {isActive ? "Active" : "Inactive"}
          </button>
          {allowKeyGen && (
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15 transition-colors"
              title="Delete"
            >
              <span className="material-symbols-outlined text-[14px]">
                delete
              </span>
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
