"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Badge, Toggle } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, isSelected, onSelect }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const isEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const displayName = isOAuthConnection
    ? (isEmail(connection.email) ? connection.email : (isEmail(connection.name) ? connection.name : (connection.name || connection.email || connection.displayName || "OAuth Account")))
    : (connection.name || connection.email || connection.displayName || "API Key");

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
    return "default";
  };

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  return (
    <tr className={`group transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${connection.isActive === false ? "opacity-60" : ""}`}>
      {/* Checkbox */}
      <td className="py-3 px-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onSelect}
          className="rounded border-black/20 dark:border-white/20 bg-transparent text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
        />
      </td>

      {/* Number with reorder controls */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5 group/row">
          <span className="text-xs font-medium text-text-muted min-w-[24px] text-right">{connection.priority}</span>
          <div className="flex flex-col opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className={`p-0.5 rounded transition-colors ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted/60 hover:text-primary hover:bg-primary/10"}`}
            >
              <span className="material-symbols-outlined text-xs">keyboard_arrow_up</span>
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className={`p-0.5 rounded transition-colors ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted/60 hover:text-primary hover:bg-primary/10"}`}
            >
              <span className="material-symbols-outlined text-xs">keyboard_arrow_down</span>
            </button>
          </div>
        </div>
      </td>

      {/* Name */}
      <td className="py-3 px-4">
        <p className="text-sm font-medium truncate max-w-[200px]">{displayName}</p>
      </td>

      {/* Identity */}
      <td className="py-3 px-4">
        <Badge variant="default" size="sm">
          {authLabel}
        </Badge>
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={getStatusVariant()} size="sm" dot>
            {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
          </Badge>
          {hasAnyProxy && (
            <Badge variant={proxyBadgeVariant} size="sm">
              Proxy
            </Badge>
          )}
          {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
          {connection.lastError && connection.isActive !== false && (
            <span className="max-w-[180px] truncate text-xs text-red-500" title={connection.lastError}>
              {connection.lastError}
            </span>
          )}
          {getOneByOneLabel() && (
            <Badge variant={getOneByOneVariant()} size="sm">
              {getOneByOneLabel()}
            </Badge>
          )}
          {hasAnyProxy && (
            <div className="w-full flex items-center gap-2 mt-1">
              <span className="max-w-[160px] truncate text-[11px] text-text-muted" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-[140px] truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5">
                  {maskedProxyUrl}
                </code>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="py-3 px-4 text-right">
        <div className="inline-flex items-center gap-2">
          {/* Proxy button with dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${hasAnyProxy ? "bg-primary/10 text-primary hover:bg-primary/15" : "bg-black/5 text-text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-sm">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span>{hasAnyProxy ? "Proxy" : "Proxy"}</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[280px] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-black/10 hover:text-primary dark:bg-white/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            <span>Edit</span>
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/15 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
            <span>Delete</span>
          </button>
          <button
            onClick={async () => {
              const newStatus = !(connection.isActive ?? true);
              setTogglingActive(true);
              try {
                await onToggleActive(newStatus);
              } finally {
                setTogglingActive(false);
              }
            }}
            disabled={togglingActive}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${(connection.isActive ?? true) ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400" : "bg-black/5 text-text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"}`}
          >
            {togglingActive ? (
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-sm">
                {(connection.isActive ?? true) ? "check_circle" : "cancel"}
              </span>
            )}
            <span>{(connection.isActive ?? true) ? "Active" : "Inactive"}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  isSelected: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
};
