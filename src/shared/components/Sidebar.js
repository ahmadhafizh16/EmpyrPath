"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = {
  id: "web",
  label: "Web Fetch & Search",
  icon: "travel_explore",
  href: "/dashboard/media-providers/web",
};

const navItems = [
  {
    href: "/dashboard/endpoint",
    label: "Endpoint",
    icon: "api",
    section: "coral",
  },
  {
    href: "/dashboard/providers",
    label: "Providers",
    icon: "dns",
    section: "blue",
  },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  {
    href: "/dashboard/combos",
    label: "Combos",
    icon: "layers",
    section: "purple",
  },
  {
    href: "/dashboard/usage",
    label: "Usage",
    icon: "bar_chart",
    section: "cyan",
  },
  {
    href: "/dashboard/quota",
    label: "Quota Tracker",
    icon: "data_usage",
    section: "coral",
  },
  {
    href: "/dashboard/mitm",
    label: "MITM",
    icon: "security",
    section: "magenta",
  },
  {
    href: "/dashboard/cli-tools",
    label: "CLI Tools",
    icon: "terminal",
    section: "purple",
  },
];

// Top-level nav rendered for role=user. Replaces the admin "Endpoint" entry
// with the reduced "My API Key" page; everything else is admin-only and the
// dashboardGuard redirects direct hits to /dashboard/my-api-key.
const userNavItems = [
  {
    href: "/dashboard/my-api-key",
    label: "My API Key",
    icon: "vpn_key",
    section: "coral",
  },
  {
    href: "/dashboard/plans",
    label: "Plans",
    icon: "shopping_bag",
    section: "magenta",
  },
  {
    href: "/dashboard/usage",
    label: "Usage",
    icon: "bar_chart",
    section: "cyan",
  },
];

const debugItems = [
  {
    href: "/dashboard/console-log",
    label: "Console Log",
    icon: "terminal",
    section: "cyan",
  },
  {
    href: "/dashboard/translator",
    label: "Translator",
    icon: "translate",
    section: "purple",
  },
];

const systemItems = [
  {
    href: "/dashboard/proxy-pools",
    label: "Proxy Pools",
    icon: "lan",
    section: "blue",
  },
  {
    href: "/dashboard/skills",
    label: "Skills",
    icon: "extension",
    section: "magenta",
  },
  { href: "/dashboard/users", label: "Users", icon: "group", section: "ink" },
  {
    href: "/dashboard/subscriptions",
    label: "Subscriptions",
    icon: "card_membership",
    section: "purple",
  },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  // null until status loads — render top-level nav optimistically, then filter
  // once role is known. Avoids a flash of admin chrome to a freshly-logged-in user.
  const [role, setRole] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.enableTranslator) setEnableTranslator(true);
      })
      .catch(() => {});
  }, []);

  // Resolve session role for nav-level RBAC. Server already redirects users
  // away from admin paths; this just keeps the chrome consistent.
  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => setRole(data?.role || null))
      .catch(() => {});
  }, []);

  const isUser = role === "user";
  const visibleNavItems = isUser ? userNavItems : navItems;

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => {
        if (data.hasUpdate) setUpdateInfo(data);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return (
        pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint")
      );
    }
    return pathname.startsWith(href);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
    } catch {
      /* clipboard blocked */
    }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-white/5 bg-[#1c1c1c] min-h-full text-[#e0e0e0]">
        {/* Logo — ink mark replaces the coral brand gradient (DESIGN.md: brand
            colors reserved for product moments, not chrome). */}
        <div className="px-6 pt-6 pb-4 flex flex-col gap-3">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-mm-xl">
              <img
                src="/icons/icon-192.png"
                alt=""
                className="size-full object-contain"
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[15px] font-semibold tracking-tight text-white">
                {APP_CONFIG.name}
              </h1>
              <span className="text-[11px] font-medium text-[#a8aab2] tracking-wide">
                v{APP_CONFIG.version}
              </span>
            </div>
          </Link>
          {!isUser && updateInfo && (
            <div className="flex flex-col gap-2 rounded-mm-xl border border-white/10 bg-[#262626] p-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                ↑ Update available — v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="rounded-full bg-white text-[#0a0a0a] px-3 py-1 text-[11px] font-semibold hover:bg-[#e0e0e0] transition-colors"
                >
                  Update
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity"
                >
                  <code className="block text-[10px] font-mono text-[#a8aab2] truncate">
                    {copied ? "✓ copied" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              section={item.section}
              isActive={isActive(item.href)}
              onClose={onClose}
            />
          ))}

          {/* System section — admin only. Users only see Settings below. */}
          <div className="pt-3 mt-2 space-y-0.5">
            {!isUser && (
              <>
                <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                  System
                </p>

                {/* Media Providers accordion */}
                <button
                  onClick={() => setMediaOpen((v) => !v)}
                  data-section="blue"
                  className={cn(
                    "group flex w-full items-center gap-3 px-3 py-1.5 rounded-full transition-colors",
                    pathname.startsWith("/dashboard/media-providers")
                      ? "section-nav-active font-semibold"
                      : "text-steel hover:bg-mm-surface hover:text-ink",
                  )}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    perm_media
                  </span>
                  <span className="text-[13px] font-medium flex-1 text-left">
                    Media Providers
                  </span>
                  <span
                    className="material-symbols-outlined text-[14px] transition-transform"
                    style={{
                      transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    expand_more
                  </span>
                </button>
                {mediaOpen && (
                  <div className="pl-4">
                    {MEDIA_PROVIDER_KINDS.filter((k) =>
                      VISIBLE_MEDIA_KINDS.includes(k.id),
                    ).map((kind) => (
                      <Link
                        key={kind.id}
                        href={`/dashboard/media-providers/${kind.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-1.5 rounded-full transition-colors",
                          pathname.startsWith(
                            `/dashboard/media-providers/${kind.id}`,
                          )
                            ? "bg-mm-surface text-ink font-semibold"
                            : "text-steel hover:bg-mm-surface hover:text-ink",
                        )}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {kind.icon}
                        </span>
                        <span className="text-sm">{kind.label}</span>
                      </Link>
                    ))}
                    <Link
                      key={COMBINED_WEB_ITEM.id}
                      href={COMBINED_WEB_ITEM.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-4 py-1.5 rounded-full transition-colors",
                        pathname.startsWith(COMBINED_WEB_ITEM.href)
                          ? "bg-mm-surface text-ink font-semibold"
                          : "text-steel hover:bg-mm-surface hover:text-ink",
                      )}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {COMBINED_WEB_ITEM.icon}
                      </span>
                      <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                    </Link>
                  </div>
                )}

                {systemItems.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    section={item.section}
                    isActive={isActive(item.href)}
                    onClose={onClose}
                  />
                ))}

                {/* Debug items (inside System section, before Settings) */}
                {debugItems.map((item) => {
                  const show =
                    item.href !== "/dashboard/translator" || enableTranslator;
                  return show ? (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      section={item.section}
                      isActive={isActive(item.href)}
                      onClose={onClose}
                    />
                  ) : null;
                })}

                {/* Remote */}
                <button
                  onClick={() => setShowRemoteModal(true)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-3 py-1.5 rounded-full transition-colors",
                    "text-steel hover:bg-mm-surface hover:text-ink",
                  )}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    computer
                  </span>
                  <span className="text-[13px] font-medium">Remote</span>
                </button>
              </>
            )}

            {/* Settings — visible to everyone (users need it to change password) */}
            <NavLink
              href="/dashboard/profile"
              label="Settings"
              icon="settings"
              section="ink"
              isActive={isActive("/dashboard/profile")}
              onClose={onClose}
            />

            {/* Logout — shortcut for everyone */}
            <button
              onClick={handleLogout}
              className={cn(
                "group flex w-full items-center gap-3 px-3 py-1.5 rounded-full transition-colors",
                "text-steel hover:bg-mm-surface hover:text-ink hover:cursor-pointer",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">
                logout
              </span>
              <span className="text-[13px] font-medium">Logout</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Remote Promo Modal */}
      <NineRemotePromoModal
        isOpen={showRemoteModal}
        onClose={() => setShowRemoteModal(false)}
      />

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update 9Router"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px]">
                  power_off
                </span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Server Disconnected
              </h2>
              <p className="text-text-muted mb-6">
                The proxy server has been stopped.
              </p>
              <Button
                variant="secondary"
                onClick={() => globalThis.location.reload()}
              >
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

// Single render path for sidebar nav rows. Keeps the section-color dot,
// tinted active pill, and hover state in one place — every nav array shares
// this. Pass `section` to opt into the per-route color identity.
function NavLink({ href, label, icon, section, isActive, onClose }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      data-section={section || undefined}
      className={cn(
        "group flex items-center gap-3 px-3 py-1.5 rounded-full transition-colors",
        isActive
          ? section
            ? "section-nav-active font-semibold"
            : "bg-mm-surface text-ink font-semibold"
          : "text-steel hover:bg-mm-surface hover:text-ink",
      )}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[18px]",
          isActive && "fill-1",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      {section && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full transition-opacity",
            isActive ? "opacity-100" : "opacity-50 group-hover:opacity-100",
          )}
          style={{ backgroundColor: "var(--sx-solid)" }}
        />
      )}
    </Link>
  );
}

NavLink.propTypes = {
  href: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  section: PropTypes.string,
  isActive: PropTypes.bool,
  onClose: PropTypes.func,
};

function ManualUpdatePanel({
  latestVersion,
  installCmd,
  copied,
  onCopyAndShutdown,
  onCancel,
  countdown,
  isDisconnected,
}) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">
            content_copy
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            Update 9Router{latestVersion ? ` to v${latestVersion}` : ""}
          </h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">
          {installCmd}
        </code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>
          Click <strong>Copy & Shutdown</strong> below.
        </li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>
          Run{" "}
          <code className="px-1 rounded bg-white/10 text-green-400">
            9router
          </code>{" "}
          again after install.
        </li>
      </ol>

      {isDisconnected ? (
        <Button
          variant="secondary"
          fullWidth
          onClick={() => globalThis.location.reload()}
        >
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isCountingDown}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={onCopyAndShutdown}
            disabled={isCountingDown}
          >
            {copied
              ? "✓ Copied — shutting down..."
              : isCountingDown
                ? `Shutting down in ${countdown}s`
                : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
