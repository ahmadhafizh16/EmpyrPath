"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Button, Modal, CardSkeleton, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";

// Locales that unlock wenyan (classical Chinese) caveman levels
const WENYAN_LOCALES = ["zh-CN", "zh-TW"];

const TUNNEL_BENEFITS = [
	{
		icon: "public",
		title: "Access Anywhere",
		desc: "Use your API from any network",
	},
	{
		icon: "group",
		title: "Share Endpoint",
		desc: "Share URL with team members",
	},
	{
		icon: "code",
		title: "Use in Cursor/Cline",
		desc: "Connect AI tools remotely",
	},
	{ icon: "lock", title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

const TUNNEL_PING_INTERVAL_MS = 2000;
const TUNNEL_PING_MAX_MS = 300000;
const STATUS_POLL_FAST_MS = 5000;
const STATUS_POLL_SLOW_MS = 30000;
const REACHABLE_MISS_THRESHOLD = 5;
const CLIENT_PING_FAST_MS = 10000;
const CLIENT_PING_SLOW_MS = 60000;
const CLIENT_PING_TIMEOUT_MS = 5000;

// Browser-side health probe: must reach origin (not just CF/TS edge).
// cors mode → res.ok=false for 5xx (e.g. Cloudflare 530 when origin dead).
// /api/health route sets Access-Control-Allow-Origin: * → CORS works through tunnel.
async function clientPingUrl(url) {
	if (!url) return false;
	try {
		const res = await fetch(`${url}/api/health`, {
			mode: "cors",
			cache: "no-store",
			signal: AbortSignal.timeout(CLIENT_PING_TIMEOUT_MS),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// Race multiple URLs: resolve true as soon as any one passes ping.
async function clientPingAny(...urls) {
	const checks = urls.filter(Boolean).map(clientPingUrl);
	if (!checks.length) return false;
	return new Promise((resolve) => {
		let pending = checks.length;
		checks.forEach((p) =>
			p.then((ok) => {
				if (ok) resolve(true);
				else if (--pending === 0) resolve(false);
			}),
		);
	});
}

const CAVEMAN_LEVELS = [
	{ id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
	{ id: "full", label: "Full", desc: "Drop articles, fragments OK" },
	{ id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
	{
		id: "wenyan-lite",
		label: "文 Lite",
		desc: "Classical Chinese, light compression",
		wenyan: true,
	},
	{
		id: "wenyan",
		label: "文 Full",
		desc: "Maximum 文言文, 80-90% reduction",
		wenyan: true,
	},
	{
		id: "wenyan-ultra",
		label: "文 Ultra",
		desc: "Extreme classical compression",
		wenyan: true,
	},
];
export default function APIPageClient({ machineId }) {
	const [keys, setKeys] = useState([]);
	const [loading, setLoading] = useState(true);
	const [showAddModal, setShowAddModal] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [createdKey, setCreatedKey] = useState(null);
	const [confirmState, setConfirmState] = useState(null);

	const [requireApiKey, setRequireApiKey] = useState(false);
	const [requireLogin, setRequireLogin] = useState(true);
	const [hasPassword, setHasPassword] = useState(true);
	const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
	const [rtkEnabled, setRtkEnabledState] = useState(true);
	const [cavemanEnabled, setCavemanEnabled] = useState(false);
	const [cavemanLevel, setCavemanLevel] = useState("full");
	const [locale, setLocale] = useState("en");

	// Cloudflare Tunnel state
	const [tunnelChecking, setTunnelChecking] = useState(true);
	const [tunnelEnabled, setTunnelEnabled] = useState(false);
	const [tunnelReachable, setTunnelReachable] = useState(false);
	const [tunnelUrl, setTunnelUrl] = useState("");
	const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
	const [tunnelLoading, setTunnelLoading] = useState(false);
	const [tunnelProgress, setTunnelProgress] = useState("");
	const [tunnelStatus, setTunnelStatus] = useState(null);
	const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
	const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

	// Tailscale state
	const [tsEnabled, setTsEnabled] = useState(false);
	const [tsReachable, setTsReachable] = useState(false);
	const [tsUrl, setTsUrl] = useState("");
	const [tsLoading, setTsLoading] = useState(false);
	const [tsProgress, setTsProgress] = useState("");
	const [tsStatus, setTsStatus] = useState(null);
	const [tsAuthUrl, setTsAuthUrl] = useState("");
	const [tsAuthLabel, setTsAuthLabel] = useState("");
	const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
	const [tsInstalling, setTsInstalling] = useState(false);
	const [tsInstallLog, setTsInstallLog] = useState([]);
	const [tsSudoPassword, setTsSudoPassword] = useState("");
	const [tsConnecting, setTsConnecting] = useState(false);
	const [showTsModal, setShowTsModal] = useState(false);
	const [showDisableTsModal, setShowDisableTsModal] = useState(false);
	const tsLogRef = useRef(null);

	// Debounce reachable=false: server may briefly return false during background refresh.
	// Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
	const tunnelMissRef = useRef(0);
	const tsMissRef = useRef(0);
	// Browser-side reachable cache (independent of backend DNS quirks)
	const tunnelClientReachableRef = useRef(false);
	const tsClientReachableRef = useRef(false);
	// Track whether reachable=true was ever observed in this session.
	// Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
	const tunnelEverReachableRef = useRef(false);
	const tsEverReachableRef = useRef(false);
	const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
	const [tsEverReachable, setTsEverReachable] = useState(false);

	// API key visibility toggle state
	const [visibleKeys, setVisibleKeys] = useState(new Set());

	// Client-side local/remote detection (UI hint only, not a security gate)
	const [isRemoteHost, setIsRemoteHost] = useState(false);
	useEffect(() => {
		if (typeof window !== "undefined")
			setIsRemoteHost(
				!["localhost", "127.0.0.1", "::1"].includes(
					window.location.hostname,
				),
			);
	}, []);

	// Track app UI locale to gate wenyan caveman levels
	useEffect(() => {
		setLocale(getCurrentLocale());
		return onLocaleChange(() => setLocale(getCurrentLocale()));
	}, []);

	const isWenyanLocale = WENYAN_LOCALES.includes(locale);
	const visibleCavemanLevels = isWenyanLocale
		? CAVEMAN_LEVELS
		: CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

	// Reset wenyan level to "ultra" when leaving a Chinese locale
	useEffect(() => {
		const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
		if (current?.wenyan && !isWenyanLocale) {
			setCavemanLevel("ultra");
			patchSetting({ cavemanLevel: "ultra" });
		}
	}, [isWenyanLocale, cavemanLevel]);

	const { copied, copy } = useCopyToClipboard();

	// Security gate: block remote exposure while dashboard uses default password or login is off.
	const isLoginUnsafe = !requireLogin || !hasPassword;
	const unsafeReason = !requireLogin
		? 'Enable "Require login" and set a custom password before activating the tunnel.'
		: "Change the default dashboard password before activating the tunnel.";

	// Auto-scroll install log
	useEffect(() => {
		if (tsLogRef.current)
			tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
	}, [tsInstallLog]);

	useEffect(() => {
		fetchData();
		loadSettings();
	}, []);

	// Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
	// Visibility re-check: refresh once when tab becomes visible.
	useEffect(() => {
		const anyEnabled = tunnelEnabled || tsEnabled;
		if (!anyEnabled) return;
		const tunnelHealthy = !tunnelEnabled || tunnelReachable;
		const tsHealthy = !tsEnabled || tsReachable;
		const allHealthy = tunnelHealthy && tsHealthy;
		const onVisible = () => {
			if (!document.hidden) syncTunnelStatus();
		};
		document.addEventListener("visibilitychange", onVisible);
		if (allHealthy)
			return () =>
				document.removeEventListener("visibilitychange", onVisible);
		const timer = setInterval(() => {
			if (!document.hidden) syncTunnelStatus();
		}, STATUS_POLL_FAST_MS);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

	// Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
	// "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
	// Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
	useEffect(() => {
		const probeBoth = async () => {
			if (document.hidden) return;
			if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
				const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
				tunnelClientReachableRef.current = ok;
				if (ok) {
					tunnelMissRef.current = 0;
					setTunnelReachable(true);
					if (!tunnelEverReachableRef.current) {
						tunnelEverReachableRef.current = true;
						setTunnelEverReachable(true);
					}
				} else {
					tunnelMissRef.current += 1;
					if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD)
						setTunnelReachable(false);
				}
			} else {
				tunnelClientReachableRef.current = false;
			}
			if (tsEnabled && tsUrl) {
				const ok = await clientPingUrl(tsUrl);
				tsClientReachableRef.current = ok;
				if (ok) {
					tsMissRef.current = 0;
					setTsReachable(true);
					if (!tsEverReachableRef.current) {
						tsEverReachableRef.current = true;
						setTsEverReachable(true);
					}
				} else {
					tsMissRef.current += 1;
					if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD)
						setTsReachable(false);
				}
			} else {
				tsClientReachableRef.current = false;
			}
		};
		const anyEnabled =
			(tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) ||
			(tsEnabled && tsUrl);
		if (!anyEnabled) return;
		probeBoth();
		const tunnelHealthy = !tunnelEnabled || tunnelReachable;
		const tsHealthy = !tsEnabled || tsReachable;
		if (tunnelHealthy && tsHealthy) return;
		const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
		return () => clearInterval(id);
	}, [
		tunnelEnabled,
		tunnelUrl,
		tunnelPublicUrl,
		tsEnabled,
		tsUrl,
		tunnelReachable,
		tsReachable,
	]);

	// Client-side reachable only (server no longer probes; watchdog handles backend health).
	// Miss-debounce: only flip to false after N consecutive misses.
	const updateReachable = useCallback(
		(_unused, clientRef, missRef, setter, everRef, everSetter) => {
			const reachable = clientRef.current;
			if (reachable) {
				missRef.current = 0;
				setter(true);
				if (!everRef.current) {
					everRef.current = true;
					everSetter(true);
				}
			} else {
				missRef.current += 1;
				if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
			}
		},
		[],
	);

	// Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
	const syncTunnelStatus = async () => {
		try {
			const statusRes = await fetch("/api/tunnel/status", {
				cache: "no-store",
			});
			if (!statusRes.ok) return;
			const data = await statusRes.json();
			const tEnabled =
				data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
			const tUrl = data.tunnel?.tunnelUrl || "";
			setTunnelUrl(tUrl);
			setTunnelPublicUrl(data.tunnel?.publicUrl || "");
			setTunnelEnabled(tEnabled);
			updateReachable(
				null,
				tunnelClientReachableRef,
				tunnelMissRef,
				setTunnelReachable,
				tunnelEverReachableRef,
				setTunnelEverReachable,
			);

			const tsEn =
				data.tailscale?.settingsEnabled ??
				data.tailscale?.enabled ??
				false;
			const tsUrlVal = data.tailscale?.tunnelUrl || "";
			setTsUrl(tsUrlVal);
			setTsEnabled(tsEn);
			updateReachable(
				null,
				tsClientReachableRef,
				tsMissRef,
				setTsReachable,
				tsEverReachableRef,
				setTsEverReachable,
			);
		} catch {
			/* ignore poll errors */
		}
	};

	const loadSettings = async () => {
		setTunnelChecking(true);
		try {
			const [settingsRes, statusRes] = await Promise.all([
				fetch("/api/settings"),
				fetch("/api/tunnel/status", { cache: "no-store" }),
			]);
			if (settingsRes.ok) {
				const data = await settingsRes.json();
				setRequireApiKey(data.requireApiKey || false);
				setRequireLogin(data.requireLogin !== false);
				setHasPassword(data.hasPassword || false);
				setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
				setRtkEnabledState(data.rtkEnabled !== false);
				setCavemanEnabled(!!data.cavemanEnabled);
				setCavemanLevel(data.cavemanLevel || "full");
			}
			if (statusRes.ok) {
				const data = await statusRes.json();
				const tEnabled =
					data.tunnel?.settingsEnabled ??
					data.tunnel?.enabled ??
					false;
				const tUrl = data.tunnel?.tunnelUrl || "";
				setTunnelUrl(tUrl);
				setTunnelPublicUrl(data.tunnel?.publicUrl || "");
				setTunnelEnabled(tEnabled);
				updateReachable(
					null,
					tunnelClientReachableRef,
					tunnelMissRef,
					setTunnelReachable,
					tunnelEverReachableRef,
					setTunnelEverReachable,
				);

				const tsEn =
					data.tailscale?.settingsEnabled ??
					data.tailscale?.enabled ??
					false;
				const tsUrlVal = data.tailscale?.tunnelUrl || "";
				setTsUrl(tsUrlVal);
				setTsEnabled(tsEn);
				updateReachable(
					null,
					tsClientReachableRef,
					tsMissRef,
					setTsReachable,
					tsEverReachableRef,
					setTsEverReachable,
				);
			}
		} catch (error) {
			console.log("Error loading settings:", error);
		} finally {
			setTunnelChecking(false);
		}
	};

	const handleTunnelDashboardAccess = async (value) => {
		try {
			const res = await fetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tunnelDashboardAccess: value }),
			});
			if (res.ok) setTunnelDashboardAccess(value);
		} catch (error) {
			console.log("Error updating tunnelDashboardAccess:", error);
		}
	};

	const handleRequireApiKey = async (value) => {
		try {
			const res = await fetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ requireApiKey: value }),
			});
			if (res.ok) setRequireApiKey(value);
		} catch (error) {
			console.log("Error updating requireApiKey:", error);
		}
	};

	const handleRtkEnabled = async (value) => {
		try {
			const res = await fetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ rtkEnabled: value }),
			});
			if (res.ok) setRtkEnabledState(value);
		} catch (error) {
			console.log("Error updating rtkEnabled:", error);
		}
	};

	const patchSetting = async (patch) => {
		try {
			await fetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});
		} catch (error) {
			console.log("Error updating setting:", error);
		}
	};

	const handleCavemanEnabled = (value) => {
		setCavemanEnabled(value);
		patchSetting({ cavemanEnabled: value });
	};

	const handleCavemanLevel = (level) => {
		setCavemanLevel(level);
		patchSetting({ cavemanLevel: level });
	};

	const fetchData = async () => {
		try {
			const keysRes = await fetch("/api/keys");
			const keysData = await keysRes.json();
			if (keysRes.ok) {
				setKeys(keysData.keys || []);
			}
		} catch (error) {
			console.log("Error fetching data:", error);
		} finally {
			setLoading(false);
		}
	};

	// u2500u2500u2500 Cloudflare Tunnel handlers
	// Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
	const pingTunnelHealth = async (...urls) => {
		setTunnelLoading(true);
		setTunnelProgress("Waiting for tunnel ready...");
		const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
		const start = Date.now();
		while (Date.now() - start < TUNNEL_PING_MAX_MS) {
			await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
			const ok = await Promise.any(
				targets.map(async (h) => {
					const p = await fetch(h, {
						mode: "cors",
						cache: "no-store",
					});
					if (p.ok) return true;
					throw new Error("not ready");
				}),
			).catch(() => false);
			if (ok) {
				setTunnelEnabled(true);
				setTunnelLoading(false);
				setTunnelProgress("");
				return true;
			}
			// Every 5 pings (~10s), check if backend process still alive
			if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
				try {
					const statusRes = await fetch("/api/tunnel/status");
					if (statusRes.ok) {
						const status = await statusRes.json();
						if (!status.tunnel?.enabled) {
							setTunnelStatus({
								type: "error",
								message: "Tunnel process stopped unexpectedly.",
							});
							setTunnelLoading(false);
							setTunnelProgress("");
							return false;
						}
					}
				} catch {
					/* ignore */
				}
			}
		}
		setTunnelStatus({
			type: "error",
			message: "Tunnel created but not reachable. Please try again.",
		});
		setTunnelLoading(false);
		setTunnelProgress("");
		return false;
	};

	const handleEnableTunnel = async () => {
		setShowEnableTunnelModal(false);
		setTunnelLoading(true);
		setTunnelStatus(null);
		setTunnelProgress("Creating tunnel...");

		// Poll download progress while enable request is pending
		let polling = true;
		const pollProgress = async () => {
			while (polling) {
				try {
					const r = await fetch("/api/tunnel/status");
					if (r.ok) {
						const s = await r.json();
						if (s.download?.downloading) {
							setTunnelProgress(
								`Downloading cloudflared... ${s.download.progress}%`,
							);
						} else if (polling) {
							setTunnelProgress("Creating tunnel...");
						}
					}
				} catch {
					/* ignore */
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
		};
		pollProgress();

		try {
			const res = await fetch("/api/tunnel/enable", { method: "POST" });
			polling = false;
			const data = await res.json();
			if (!res.ok) {
				setTunnelStatus({
					type: "error",
					message: data.error || "Failed to enable tunnel",
				});
				return;
			}

			const url = data.tunnelUrl;
			if (!url) {
				setTunnelStatus({
					type: "error",
					message: "No tunnel URL returned",
				});
				return;
			}

			setTunnelUrl(url);
			setTunnelPublicUrl(data.publicUrl || "");
			await pingTunnelHealth(data.publicUrl, url);
		} catch (error) {
			setTunnelStatus({ type: "error", message: error.message });
		} finally {
			polling = false;
			setTunnelLoading(false);
			setTunnelProgress("");
		}
	};

	const handleDisableTunnel = async () => {
		setTunnelLoading(true);
		setTunnelStatus(null);
		try {
			const res = await fetch("/api/tunnel/disable", { method: "POST" });
			const data = await res.json();
			if (res.ok) {
				setTunnelEnabled(false);
				setTunnelUrl("");
				setShowDisableTunnelModal(false);
				setTunnelStatus({
					type: "success",
					message: "Tunnel disabled",
				});
			} else {
				setTunnelStatus({
					type: "error",
					message: data.error || "Failed to disable tunnel",
				});
			}
		} catch (error) {
			setTunnelStatus({ type: "error", message: error.message });
		} finally {
			setTunnelLoading(false);
		}
	};

	// u2500u2500u2500 Tailscale handlers
	const checkTailscaleInstalled = async () => {
		setTsInstalled(null);
		try {
			const res = await fetch("/api/tunnel/tailscale-check");
			if (res.ok) {
				const data = await res.json();
				setTsInstalled(data.installed);
				return data;
			}
		} catch {
			/* ignore */
		}
		setTsInstalled(false);
		return { installed: false };
	};

	const handleInstallTailscale = async () => {
		setTsInstalling(true);
		setTsStatus(null);
		setTsInstallLog([]);
		try {
			const res = await fetch("/api/tunnel/tailscale-install", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sudoPassword: tsSudoPassword }),
			});
			setTsSudoPassword("");

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop() || "";
				for (const part of parts) {
					const lines = part.split("\n");
					let event = "progress";
					let data = null;
					for (const line of lines) {
						if (line.startsWith("event: "))
							event = line.slice(7).trim();
						if (line.startsWith("data: ")) {
							try {
								data = JSON.parse(line.slice(6));
							} catch {
								/* skip */
							}
						}
					}
					if (!data) continue;
					if (event === "progress") {
						setTsInstallLog((prev) => [
							...prev.slice(-50),
							data.message,
						]);
					} else if (event === "done") {
						setTsInstalled(true);
						setTsInstalling(false);
						setShowTsModal(false);
						handleConnectTailscale();
						return;
					} else if (event === "error") {
						setTsStatus({
							type: "error",
							message: data.error || "Install failed",
						});
					}
				}
			}
		} catch (e) {
			setTsStatus({ type: "error", message: e.message });
		} finally {
			setTsInstalling(false);
		}
	};

	// Ping Tailscale health until reachable
	const pingTsHealth = async (url) => {
		setTsProgress("Waiting for Tailscale ready...");
		const healthUrl = `${url}/api/health`;
		const start = Date.now();
		while (Date.now() - start < TUNNEL_PING_MAX_MS) {
			await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
			try {
				const ping = await fetch(healthUrl, {
					mode: "no-cors",
					cache: "no-store",
				});
				if (ping.ok || ping.type === "opaque") return true;
			} catch {
				/* not ready yet */
			}
		}
		return false;
	};

	// Show inline login button instead of auto-opening popup (browsers block popups
	// opened after async work because the user gesture is lost).
	const requestUserAuth = (url, label) => {
		setTsAuthUrl(url);
		setTsAuthLabel(label);
	};

	const clearUserAuth = () => {
		setTsAuthUrl("");
		setTsAuthLabel("");
	};

	const handleConnectTailscale = async () => {
		setShowTsModal(false);
		setTsConnecting(true);
		setTsLoading(true);
		setTsStatus(null);
		setTsProgress("Connecting...");
		clearUserAuth();
		try {
			const res = await fetch("/api/tunnel/tailscale-enable", {
				method: "POST",
			});
			const data = await res.json();

			if (res.ok && data.success) {
				setTsUrl(data.tunnelUrl || "");
				const reachable = await pingTsHealth(data.tunnelUrl);
				setTsEnabled(true);
				setTsStatus(
					reachable
						? null
						: {
								type: "warning",
								message: "Connected but not reachable yet.",
							},
				);
				return;
			}

			if (data.needsLogin && data.authUrl) {
				requestUserAuth(data.authUrl, "Open Login Page");
				setTsProgress(
					'Login required — click "Open Login Page" to continue',
				);
				for (let i = 0; i < 40; i++) {
					await new Promise((r) => setTimeout(r, 3000));
					try {
						const r2 = await fetch("/api/tunnel/tailscale-check");
						if (r2.ok) {
							const check = await r2.json();
							if (check.loggedIn) {
								clearUserAuth();
								setTsProgress("Starting funnel...");
								const res2 = await fetch(
									"/api/tunnel/tailscale-enable",
									{ method: "POST" },
								);
								const data2 = await res2.json();
								if (res2.ok && data2.success) {
									setTsUrl(data2.tunnelUrl || "");
									const ok2 = await pingTsHealth(
										data2.tunnelUrl,
									);
									setTsEnabled(true);
									setTsStatus(
										ok2
											? null
											: {
													type: "warning",
													message:
														"Connected but not reachable yet.",
												},
									);
								} else if (
									data2.funnelNotEnabled &&
									data2.enableUrl
								) {
									await pollFunnelEnable(data2.enableUrl);
								} else {
									setTsStatus({
										type: "error",
										message:
											data2.error ||
											"Failed to start funnel",
									});
								}
								return;
							}
						}
					} catch {
						/* retry */
					}
				}
				clearUserAuth();
				setTsStatus({
					type: "error",
					message: "Login timed out. Please try again.",
				});
				return;
			}

			if (data.funnelNotEnabled && data.enableUrl) {
				await pollFunnelEnable(data.enableUrl);
				return;
			}

			setTsStatus({
				type: "error",
				message: data.error || "Failed to connect",
			});
		} catch (error) {
			setTsStatus({ type: "error", message: error.message });
		} finally {
			setTsLoading(false);
			setTsConnecting(false);
			setTsProgress("");
			clearUserAuth();
		}
	};

	const pollFunnelEnable = async (enableUrl) => {
		requestUserAuth(enableUrl, "Open Funnel Settings");
		setTsProgress('Click "Open Funnel Settings" to enable Funnel...');
		for (let i = 0; i < 40; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			try {
				const res = await fetch("/api/tunnel/tailscale-enable", {
					method: "POST",
				});
				const data = await res.json();
				if (res.ok && data.success) {
					clearUserAuth();
					setTsUrl(data.tunnelUrl || "");
					const ok3 = await pingTsHealth(data.tunnelUrl);
					setTsEnabled(true);
					setTsStatus(
						ok3
							? null
							: {
									type: "warning",
									message: "Connected but not reachable yet.",
								},
					);
					return;
				}
				if (data.funnelNotEnabled) continue;
				if (data.error) {
					clearUserAuth();
					setTsStatus({ type: "error", message: data.error });
					return;
				}
			} catch {
				/* retry */
			}
		}
		clearUserAuth();
		setTsStatus({
			type: "error",
			message: "Timed out waiting for Funnel to be enabled.",
		});
	};

	const handleDisableTailscale = async () => {
		setTsLoading(true);
		setTsStatus(null);
		try {
			const res = await fetch("/api/tunnel/tailscale-disable", {
				method: "POST",
			});
			const data = await res.json();
			if (res.ok) {
				setTsEnabled(false);
				setTsUrl("");
				setShowDisableTsModal(false);
				setTsStatus({ type: "success", message: "Tailscale disabled" });
			} else {
				setTsStatus({
					type: "error",
					message: data.error || "Failed to disable Tailscale",
				});
			}
		} catch (e) {
			setTsStatus({ type: "error", message: e.message });
		} finally {
			setTsLoading(false);
		}
	};

	const handleOpenTsModal = async () => {
		setTsStatus(null);
		setTsInstallLog([]);
		const data = await checkTailscaleInstalled();
		if (data?.installed && data?.hasCachedPassword) {
			handleConnectTailscale();
		} else {
			setShowTsModal(true);
		}
	};

	const handleCreateKey = async () => {
		if (!newKeyName.trim()) return;

		try {
			const res = await fetch("/api/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: newKeyName }),
			});
			const data = await res.json();

			if (res.ok) {
				setCreatedKey(data.key);
				await fetchData();
				setNewKeyName("");
				setShowAddModal(false);
			}
		} catch (error) {
			console.log("Error creating key:", error);
		}
	};

	const handleDeleteKey = async (id) => {
		setConfirmState({
			title: "Delete API Key",
			message: "Delete this API key?",
			onConfirm: async () => {
				setConfirmState(null);
				try {
					const res = await fetch(`/api/keys/${id}`, {
						method: "DELETE",
					});
					if (res.ok) {
						setKeys(keys.filter((k) => k.id !== id));
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
			if (res.ok) {
				setKeys((prev) =>
					prev.map((k) => (k.id === id ? { ...k, isActive } : k)),
				);
			}
		} catch (error) {
			console.log("Error toggling key:", error);
		}
	};

	const maskKey = (fullKey) => {
		if (!fullKey) return "";
		return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
	};

	const toggleKeyVisibility = (keyId) => {
		setVisibleKeys((prev) => {
			const next = new Set(prev);
			if (next.has(keyId)) next.delete(keyId);
			else next.add(keyId);
			return next;
		});
	};

	const [baseUrl, setBaseUrl] = useState("/v1");

	// Hydration fix: Only access window on client side
	useEffect(() => {
		if (typeof window !== "undefined") {
			setBaseUrl(`${window.location.origin}/v1`);
		}
	}, []);

	if (loading) {
		return (
			<div className="flex flex-col gap-8">
				<CardSkeleton />
				<CardSkeleton />
			</div>
		);
	}

	const currentEndpoint = baseUrl;

	return (
		<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
			{/* ── Row 1 Left: API Endpoint ── */}
			<div
				data-section="coral"
				className="rounded-hero bg-[#1c1c1c] border border-white/[0.06] p-7 sm:p-8 text-white flex flex-col"
			>
				<div className="flex items-center gap-3.5 mb-7">
					<span className="inline-flex items-center justify-center size-11 rounded-xl section-mark border border-white/20">
						<span className="material-symbols-outlined text-[22px]">
							api
						</span>
					</span>
					<div>
						<h2 className="text-lg font-semibold tracking-tight">
							API Endpoint
						</h2>
						<p className="text-[13px] text-white/40 mt-0.5">
							Connect agents to every model
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-3 flex-1">
					{/* Local */}
					<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<span className="material-symbols-outlined text-[16px] text-white/50">
									computer
								</span>
								<span className="text-[13px] font-medium text-white/70">
									Apps URL
								</span>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<div className="flex-1 min-w-0 rounded-[10px] bg-white/5 border border-white/10 px-3 py-2 font-mono text-[13px] text-white/80 truncate">
								{currentEndpoint}
							</div>
							<DarkIconBtn
								onClick={() =>
									copy(currentEndpoint, "local_url")
								}
								icon={
									copied === "local_url"
										? "check"
										: "content_copy"
								}
								title="Copy URL"
								small
							/>
						</div>
					</div>

					{/* Tunnel */}
					<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<span className="material-symbols-outlined text-[16px] text-white/50">
									cloud
								</span>
								<span className="text-[13px] font-medium text-white/70">
									Tunnel
								</span>
							</div>
							{tunnelEnabled && (
								<span
									className={`flex items-center gap-1 text-[11px] font-medium ${tunnelReachable ? "text-green-400" : "text-amber-400"}`}
								>
									<span
										className={`size-1.5 rounded-full ${tunnelReachable ? "bg-green-400" : "bg-amber-400 animate-pulse"}`}
									/>
									{tunnelReachable
										? "Active"
										: tunnelEverReachable
											? "Reconnecting"
											: "Checking"}
								</span>
							)}
						</div>
						{tunnelEnabled && !tunnelLoading && tunnelReachable ? (
							<div className="flex items-center gap-2">
								<div className="flex-1 min-w-0 rounded-[10px] bg-white/5 border border-white/10 px-3 py-2 font-mono text-[13px] text-white/80 truncate">
									{tunnelPublicUrl || tunnelUrl}/v1
								</div>
								<DarkIconBtn
									onClick={() =>
										copy(
											`${tunnelPublicUrl || tunnelUrl}/v1`,
											"tunnel_url",
										)
									}
									icon={
										copied === "tunnel_url"
											? "check"
											: "content_copy"
									}
									title="Copy URL"
									small
								/>
								<DarkIconBtn
									onClick={() =>
										setShowDisableTunnelModal(true)
									}
									icon="power_settings_new"
									title="Disable"
									danger
									small
								/>
							</div>
						) : tunnelEnabled &&
						  !tunnelLoading &&
						  !tunnelReachable ? (
							<div className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-amber-400/20 bg-amber-400/5 text-[13px] text-amber-300">
								<span className="material-symbols-outlined animate-spin text-[14px]">
									progress_activity
								</span>
								{tunnelEverReachable
									? "Reconnecting..."
									: "Checking..."}
							</div>
						) : tunnelLoading ? (
							<div className="flex items-center gap-2">
								<div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/5 border border-white/10 text-[13px] text-white/50">
									<span className="material-symbols-outlined animate-spin text-[14px]">
										progress_activity
									</span>
									{tunnelProgress || "Creating..."}
								</div>
								<DarkIconBtn
									onClick={() => {
										setTunnelLoading(false);
										setTunnelProgress("");
									}}
									icon="power_settings_new"
									title="Stop"
									danger
									small
								/>
							</div>
						) : tunnelStatus?.type === "error" ? (
							<div className="space-y-2">
								<p className="text-[12px] text-red-300">
									{tunnelStatus.message}
								</p>
								<Button
									size="sm"
									icon="cloud_upload"
									className="bg-white/10 border border-white/15 text-white hover:bg-white/15"
									onClick={() =>
										setShowEnableTunnelModal(true)
									}
								>
									Enable
								</Button>
							</div>
						) : tunnelChecking ? (
							<div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/5 border border-white/10 text-[13px] text-white/50">
								<span className="material-symbols-outlined animate-spin text-[14px]">
									progress_activity
								</span>
								Checking...
							</div>
						) : (
							<Button
								size="sm"
								icon="cloud_upload"
								onClick={() => {
									if (isLoginUnsafe) {
										setTunnelStatus({
											type: "error",
											message: `Security required: ${unsafeReason}`,
										});
										return;
									}
									if (!requireApiKey) {
										setTunnelStatus({
											type: "error",
											message:
												'Enable "Require API key" before activating the tunnel.',
										});
										return;
									}
									setShowEnableTunnelModal(true);
								}}
								className="bg-white/10 border border-white/15 text-white hover:bg-white/15 w-full"
							>
								Enable Tunnel
							</Button>
						)}
					</div>

					{/* Tailscale */}
					<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<span className="material-symbols-outlined text-[16px] text-white/50">
									vpn_lock
								</span>
								<span className="text-[13px] font-medium text-white/70">
									Tailscale
								</span>
							</div>
							{tsEnabled && (
								<span
									className={`flex items-center gap-1 text-[11px] font-medium ${tsReachable ? "text-green-400" : "text-amber-400"}`}
								>
									<span
										className={`size-1.5 rounded-full ${tsReachable ? "bg-green-400" : "bg-amber-400 animate-pulse"}`}
									/>
									{tsReachable
										? "Active"
										: tsEverReachable
											? "Reconnecting"
											: "Checking"}
								</span>
							)}
						</div>
						{tsEnabled && !tsLoading && tsReachable ? (
							<div className="flex items-center gap-2">
								<div className="flex-1 min-w-0 rounded-[10px] bg-white/5 border border-white/10 px-3 py-2 font-mono text-[13px] text-white/80 truncate">
									{tsUrl}/v1
								</div>
								<DarkIconBtn
									onClick={() =>
										copy(`${tsUrl}/v1`, "ts_url")
									}
									icon={
										copied === "ts_url"
											? "check"
											: "content_copy"
									}
									title="Copy URL"
									small
								/>
								<DarkIconBtn
									onClick={() => setShowDisableTsModal(true)}
									icon="power_settings_new"
									title="Disable"
									danger
									small
								/>
							</div>
						) : tsEnabled && !tsLoading && !tsReachable ? (
							<div className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-amber-400/20 bg-amber-400/5 text-[13px] text-amber-300">
								<span className="material-symbols-outlined animate-spin text-[14px]">
									progress_activity
								</span>
								{tsEverReachable
									? "Reconnecting..."
									: "Checking..."}
							</div>
						) : tsLoading || tsConnecting ? (
							<div className="flex items-center gap-2">
								<div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/5 border border-white/10 text-[13px] text-white/50">
									<span className="material-symbols-outlined animate-spin text-[14px]">
										progress_activity
									</span>
									{tsProgress || "Connecting..."}
								</div>
								{tsAuthUrl && (
									<Button
										size="sm"
										icon="open_in_new"
										className="bg-white/10 border border-white/15 text-white hover:bg-white/15"
										onClick={() =>
											window.open(
												tsAuthUrl,
												"tailscale_auth",
												"width=600,height=700,noopener,noreferrer",
											)
										}
									>
										{tsAuthLabel || "Login"}
									</Button>
								)}
								<DarkIconBtn
									onClick={() => {
										setTsLoading(false);
										setTsConnecting(false);
										setTsProgress("");
										clearUserAuth();
									}}
									icon="power_settings_new"
									title="Stop"
									danger
									small
								/>
							</div>
						) : tsStatus?.type === "error" ? (
							<div className="space-y-2">
								<p className="text-[12px] text-red-300">
									{tsStatus.message}
								</p>
								<Button
									size="sm"
									icon="vpn_lock"
									className="bg-white/10 border border-white/15 text-white hover:bg-white/15"
									onClick={handleOpenTsModal}
								>
									Enable
								</Button>
							</div>
						) : (
							<Button
								size="sm"
								icon="vpn_lock"
								onClick={() => {
									if (isLoginUnsafe) {
										setTsStatus({
											type: "error",
											message: `Security required: ${unsafeReason}`,
										});
										return;
									}
									handleOpenTsModal();
								}}
								className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white border-0 w-full"
							>
								Enable Tailscale
							</Button>
						)}
					</div>
				</div>

				{/* Security gate */}
				{isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
					<div className="mt-5">
						<SecurityWarning
							message={unsafeReason}
							action={{
								label: "Open settings",
								href: "/dashboard/profile",
							}}
							dark
						/>
					</div>
				)}

				{/* Security warnings */}
				{(tunnelEnabled || tsEnabled) && (
					<div className="mt-5 flex flex-col gap-2">
						{!requireApiKey && (
							<SecurityWarning
								dark
								message="Require API key is disabled — your endpoint is publicly accessible without authentication."
								action={{
									label: "Enable",
									href: "#require-api-key",
								}}
							/>
						)}
						{(!requireLogin || !hasPassword) && (
							<SecurityWarning
								dark
								message={
									!requireLogin
										? "Require login is disabled — anyone can access your dashboard via tunnel."
										: "Dashboard uses the default password — change it in Profile settings."
								}
								action={{
									label: !requireLogin
										? "Enable"
										: "Change password",
									href: "/dashboard/profile",
								}}
							/>
						)}
					</div>
				)}

				{/* Dashboard access via tunnel */}
				{(tunnelEnabled || tsEnabled) && (
					<div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center gap-3">
						<DarkToggle
							checked={tunnelDashboardAccess}
							onChange={() =>
								handleTunnelDashboardAccess(
									!tunnelDashboardAccess,
								)
							}
						/>
						<div className="flex items-center gap-1.5">
							<p className="text-[13px] text-white/60">
								Allow dashboard access via tunnel
							</p>
							<DarkTooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
						</div>
					</div>
				)}
			</div>

			{/* ── Row 1 Right: Token Saver ── */}
			<div
				id="rtk"
				data-section="coral"
				className="rounded-hero bg-[#1c1c1c] border border-white/[0.06] p-7 sm:p-8 text-white flex flex-col"
			>
				<div className="flex items-center gap-3.5 mb-7">
					<span className="inline-flex items-center justify-center size-11 rounded-xl section-mark border border-white/20">
						<span className="material-symbols-outlined text-[22px]">
							bolt
						</span>
					</span>
					<div>
						<h2 className="text-lg font-semibold tracking-tight">
							Token Saver
						</h2>
						<p className="text-[13px] text-white/40 mt-0.5">
							Reduce token usage
						</p>
					</div>
				</div>

				{/* RTK */}
				<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 mb-4">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<p className="text-[14px] font-medium text-white/90">
									Compress tool output
								</p>
								<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-coral-mm/15 text-brand-coral-mm">
									RTK
								</span>
							</div>
							<p className="text-[12px] text-white/35 mt-1.5 leading-relaxed">
								git / grep / ls / tree / logs → 60-90% fewer
								input tokens
							</p>
							<a
								href="https://github.com/rtk-ai/rtk"
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-[11px] text-white/25 hover:text-white/50 mt-2 transition-colors"
							>
								<span className="material-symbols-outlined text-[12px]">
									open_in_new
								</span>
								github.com/rtk-ai/rtk
							</a>
						</div>
						<DarkToggle
							checked={rtkEnabled}
							onChange={() => handleRtkEnabled(!rtkEnabled)}
						/>
					</div>
				</div>

				{/* Caveman */}
				<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<p className="text-[14px] font-medium text-white/90">
									Compress LLM output
								</p>
								<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-purple/15 text-brand-purple">
									Caveman
								</span>
							</div>
							<p className="text-[12px] text-white/35 mt-1.5 leading-relaxed">
								Terse system prompt → ~65% fewer output tokens
							</p>
							<a
								href="https://github.com/JuliusBrussee/caveman"
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-[11px] text-white/25 hover:text-white/50 mt-2 transition-colors"
							>
								<span className="material-symbols-outlined text-[12px]">
									open_in_new
								</span>
								github.com/.../caveman
							</a>
						</div>
						<DarkToggle
							checked={cavemanEnabled}
							onChange={() =>
								handleCavemanEnabled(!cavemanEnabled)
							}
						/>
					</div>
					{cavemanEnabled && (
						<div className="mt-4 pt-4 border-t border-white/[0.06]">
							<p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2.5">
								Compression level
							</p>
							<div className="flex items-center gap-1.5">
								{visibleCavemanLevels.map((lvl) => (
									<button
										key={lvl.id}
										onClick={() =>
											handleCavemanLevel(lvl.id)
										}
										className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
											cavemanLevel === lvl.id
												? "bg-white text-[#1c1c1c] border-white"
												: "bg-transparent border-white/10 text-white/40 hover:bg-white/5 hover:text-white/70"
										}`}
										title={lvl.desc}
									>
										{lvl.label}
									</button>
								))}
							</div>
							<p className="text-[11px] text-white/30 mt-2.5">
								{
									CAVEMAN_LEVELS.find(
										(lvl) => lvl.id === cavemanLevel,
									)?.desc
								}
							</p>
						</div>
					)}
				</div>

				{/* Spacer to balance card heights */}
				<div className="flex-1" />
			</div>

			{/* ── Row 2: API Keys (full width) ── */}
			<div
				id="require-api-key"
				data-section="coral"
				className="xl:col-span-2 rounded-hero bg-[#1c1c1c] border border-white/[0.06] p-7 sm:p-8 text-white flex flex-col"
			>
				<div className="flex items-center justify-between mb-7">
					<div className="flex items-center gap-3.5">
						<span className="inline-flex items-center justify-center size-11 rounded-xl section-mark border border-white/20">
							<span className="material-symbols-outlined text-[22px]">
								vpn_key
							</span>
						</span>
						<div>
							<h2 className="text-lg font-semibold tracking-tight">
								API Keys
							</h2>
							<p className="text-[13px] text-white/40 mt-0.5">
								Authenticate requests
							</p>
						</div>
					</div>
					<Button
						size="sm"
						icon="add"
						className="bg-white text-[#1c1c1c] hover:bg-white/90 border-0 font-semibold"
						onClick={() => setShowAddModal(true)}
					>
						Create Key
					</Button>
				</div>

				{/* Require API key */}
				<div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-3.5 mb-5">
					<div className="flex items-center justify-between gap-4">
						<div className="min-w-0">
							<p className="text-[14px] font-medium text-white/90">
								Require API key
							</p>
							<p className="text-[12px] text-white/35 mt-0.5">
								Reject unauthenticated requests
							</p>
						</div>
						<DarkToggle
							checked={requireApiKey}
							onChange={() => handleRequireApiKey(!requireApiKey)}
						/>
					</div>
				</div>

				{isRemoteHost && !requireApiKey && (
					<div className="mb-4">
						<SecurityWarning
							dark
							message="Endpoint is exposed without an API key."
						/>
					</div>
				)}

				{/* Key list */}
				{keys.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center py-10">
						<span className="material-symbols-outlined text-[40px] text-white/15 mb-3">
							vpn_key_off
						</span>
						<p className="text-white/70 font-medium mb-1">
							No API keys yet
						</p>
						<p className="text-[13px] text-white/35 mb-5">
							Create your first key to get started
						</p>
						<Button
							icon="add"
							className="bg-white text-[#1c1c1c] hover:bg-white/90 border-0 font-semibold"
							onClick={() => setShowAddModal(true)}
						>
							Create Key
						</Button>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr className="border-b border-white/[0.08]">
									<th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wider pb-3 pr-4">
										Token Name
									</th>
									<th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wider pb-3 pr-4">
										Token
									</th>
									<th className="text-right text-[11px] font-semibold text-white/40 uppercase tracking-wider pb-3">
										Action
									</th>
								</tr>
							</thead>
							<tbody>
								{keys.map((key) => (
									<tr
										key={key.id}
										className={`group border-b border-white/[0.04] last:border-b-0 ${key.isActive === false ? "opacity-40" : ""}`}
									>
										{/* Token Name */}
										<td className="py-3.5 pr-4">
											<p className="text-[13px] font-semibold text-white/90">
												{key.name}
											</p>
										</td>

										{/* Token */}
										<td className="py-3.5 pr-4">
											<div className="flex items-center gap-2">
												<code className="text-[11px] text-white/35 font-mono select-all">
													{visibleKeys.has(key.id)
														? key.key
														: key.key.slice(0, 5) + "*".repeat(Math.max(0, key.key.length - 5))}
												</code>
												<DarkIconBtn
													icon={
														visibleKeys.has(key.id)
															? "visibility_off"
															: "visibility"
													}
													onClick={() =>
														toggleKeyVisibility(key.id)
													}
													title={
														visibleKeys.has(key.id)
															? "Hide"
															: "Show"
													}
													small
												/>
												<DarkIconBtn
													icon={
														copied === key.id
															? "check"
															: "content_copy"
													}
													onClick={() =>
														copy(key.key, key.id)
													}
													title="Copy key"
													small
												/>
											</div>
										</td>

										{/* Action */}
										<td className="py-3.5 text-right">
											<div className="flex items-center justify-end gap-2">
												<button
													type="button"
													onClick={() => {
														const next = !(key.isActive ?? true);
														if (key.isActive && !next) {
															setConfirmState({
																title: "Pause API Key",
																message: `Pause "${key.name}"? It will stop working but can be resumed.`,
																onConfirm: async () => {
																	setConfirmState(null);
																	handleToggleKey(key.id, next);
																},
															});
														} else {
															handleToggleKey(key.id, next);
														}
													}}
													className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
														key.isActive ?? true
															? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/15"
															: "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
													}`}
													title={
														key.isActive ?? true
															? "Pause key"
															: "Resume key"
													}
												>
													<span className="material-symbols-outlined text-[14px]">
														{key.isActive ?? true ? "play_circle" : "pause_circle"}
													</span>
													{key.isActive ?? true ? "Active" : "Inactive"}
												</button>
												<button
													type="button"
													onClick={() => handleDeleteKey(key.id)}
													className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15 transition-colors"
													title="Delete"
												>
													<span className="material-symbols-outlined text-[14px]">
														delete
													</span>
													Delete
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* ── Modals ── */}
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
						placeholder="Production Key"
						className="w-full py-2.5 px-3 text-sm text-[#f5f5f5] bg-[#1f1f1f] rounded-[10px] border border-white/10 placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors text-[16px] sm:text-sm"
					/>
					<div className="flex gap-2">
						<Button
							onClick={handleCreateKey}
							fullWidth
							disabled={!newKeyName.trim()}
						>
							Create
						</Button>
						<Button
							onClick={() => {
								setShowAddModal(false);
								setNewKeyName("");
							}}
							variant="ghost"
							fullWidth
						>
							Cancel
						</Button>
					</div>
				</div>
			</Modal>

			<Modal
				isOpen={!!createdKey}
				title="API Key Created"
				onClose={() => setCreatedKey(null)}
			>
				<div className="flex flex-col gap-4">
					<div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
						<p className="text-sm text-amber-300 mb-2 font-medium">
							Save this key now!
						</p>
						<p className="text-sm text-amber-200/70">
							This is the only time you will see this key. Store
							it securely.
						</p>
					</div>
					<div className="flex gap-2">
						<input
							value={createdKey || ""}
							readOnly
							className="flex-1 py-2.5 px-3 text-sm text-[#f5f5f5] bg-[#1f1f1f] rounded-[10px] border border-white/10 font-mono focus:outline-none text-[16px] sm:text-sm"
						/>
						<Button
							variant="secondary"
							icon={
								copied === "created_key"
									? "check"
									: "content_copy"
							}
							onClick={() => copy(createdKey, "created_key")}
						>
							{copied === "created_key" ? "Copied!" : "Copy"}
						</Button>
					</div>
					<Button onClick={() => setCreatedKey(null)} fullWidth>
						Done
					</Button>
				</div>
			</Modal>

			<Modal
				isOpen={showEnableTunnelModal}
				title="Enable Tunnel"
				onClose={() => setShowEnableTunnelModal(false)}
			>
				<div className="flex flex-col gap-4">
					<div className="bg-white/5 border border-white/10 rounded-lg p-4">
						<div className="flex items-start gap-3">
							<span className="material-symbols-outlined text-white/70">
								cloud_upload
							</span>
							<div>
								<p className="text-sm text-white/90 font-medium mb-1">
									Cloudflare Tunnel
								</p>
								<p className="text-sm text-white/50">
									Expose your local 9Router to the internet.
									No port forwarding, no static IP needed.
								</p>
							</div>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						{TUNNEL_BENEFITS.map((benefit) => (
							<div
								key={benefit.title}
								className="flex flex-col items-center text-center p-3 rounded-lg bg-white/5"
							>
								<span className="material-symbols-outlined text-xl text-white/70 mb-1">
									{benefit.icon}
								</span>
								<p className="text-xs font-semibold text-white/90">
									{benefit.title}
								</p>
								<p className="text-xs text-white/40">
									{benefit.desc}
								</p>
							</div>
						))}
					</div>
					<p className="text-xs text-white/40">
						Requires outbound port 7844 (TCP/UDP). Connection may
						take 10-30s.
					</p>
					<div className="flex gap-2">
						<Button onClick={handleEnableTunnel} fullWidth>
							Start Tunnel
						</Button>
						<Button
							onClick={() => setShowEnableTunnelModal(false)}
							variant="ghost"
							fullWidth
						>
							Cancel
						</Button>
					</div>
				</div>
			</Modal>

			<Modal
				isOpen={showDisableTunnelModal}
				title="Disable Tunnel"
				onClose={() =>
					!tunnelLoading && setShowDisableTunnelModal(false)
				}
			>
				<div className="flex flex-col gap-4">
					<p className="text-sm text-white/50">
						The Cloudflare tunnel will be disconnected. Remote
						access via tunnel URL will stop working.
					</p>
					<div className="flex gap-2">
						<Button
							onClick={handleDisableTunnel}
							fullWidth
							disabled={tunnelLoading}
							variant="danger"
						>
							{tunnelLoading ? "Disabling..." : "Disable"}
						</Button>
						<Button
							onClick={() => setShowDisableTunnelModal(false)}
							variant="ghost"
							fullWidth
							disabled={tunnelLoading}
						>
							Cancel
						</Button>
					</div>
				</div>
			</Modal>

			<Modal
				isOpen={showTsModal}
				title="Tailscale Funnel"
				onClose={() => {
					if (!tsInstalling) {
						setShowTsModal(false);
						setTsSudoPassword("");
						setTsStatus(null);
					}
				}}
			>
				<div className="flex flex-col gap-4">
					{tsInstalled === null && (
						<p className="text-sm text-white/50 flex items-center gap-2">
							<span className="material-symbols-outlined animate-spin text-sm">
								progress_activity
							</span>{" "}
							Checking...
						</p>
					)}
					{tsInstalled === false && !tsInstalling && (
						<div className="flex flex-col gap-3">
							<p className="text-sm text-white/50">
								Tailscale is not installed. Install it to enable
								Funnel.
							</p>
							<div className="flex gap-2">
								<Button
									onClick={handleInstallTailscale}
									fullWidth
								>
									Install Tailscale
								</Button>
								<Button
									onClick={() => setShowTsModal(false)}
									variant="ghost"
									fullWidth
								>
									Cancel
								</Button>
							</div>
						</div>
					)}
					{tsInstalling && (
						<div className="flex flex-col gap-2">
							<div className="flex items-center gap-2 text-sm text-white/50">
								<span className="material-symbols-outlined animate-spin text-sm">
									progress_activity
								</span>{" "}
								Installing Tailscale...
							</div>
							{tsInstallLog.length > 0 && (
								<div
									ref={tsLogRef}
									className="bg-black/30 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-white/50"
								>
									{tsInstallLog.map((line, i) => (
										<div key={i}>{line}</div>
									))}
								</div>
							)}
						</div>
					)}
					{tsInstalled === true && !tsInstalling && (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2 text-sm text-green-400">
								<span className="material-symbols-outlined text-[16px]">
									check_circle
								</span>{" "}
								Tailscale installed
							</div>
							<div className="flex gap-2">
								<Button
									onClick={() => handleConnectTailscale()}
									fullWidth
								>
									Connect
								</Button>
								<Button
									onClick={() => setShowTsModal(false)}
									variant="ghost"
									fullWidth
								>
									Cancel
								</Button>
							</div>
						</div>
					)}
					{tsStatus && <StatusAlert status={tsStatus} />}
				</div>
			</Modal>

			<Modal
				isOpen={showDisableTsModal}
				title="Disable Tailscale"
				onClose={() => !tsLoading && setShowDisableTsModal(false)}
			>
				<div className="flex flex-col gap-4">
					<p className="text-sm text-white/50">
						Tailscale Funnel will be stopped. Remote access via
						Tailscale URL will stop working.
					</p>
					<div className="flex gap-2">
						<Button
							onClick={handleDisableTailscale}
							fullWidth
							disabled={tsLoading}
							variant="danger"
						>
							{tsLoading ? "Disabling..." : "Disable"}
						</Button>
						<Button
							onClick={() => setShowDisableTsModal(false)}
							variant="ghost"
							fullWidth
							disabled={tsLoading}
						>
							Cancel
						</Button>
					</div>
				</div>
			</Modal>

			<ConfirmModal
				isOpen={!!confirmState}
				onClose={() => setConfirmState(null)}
				onConfirm={confirmState?.onConfirm}
				title={confirmState?.title || "Confirm"}
				message={confirmState?.message}
				variant="danger"
			/>
		</div>
	);
}

/** Reusable status alert */
function StatusAlert({ status, className = "" }) {
	const renderMessage = (msg) => {
		const parts = msg.split(/(https?:\/\/[^\s]+)/g);
		return parts.map((part, i) =>
			/^https?:\/\//.test(part) ? (
				<a
					key={i}
					href={part}
					target="_blank"
					rel="noreferrer"
					className="underline font-medium"
				>
					{part}
				</a>
			) : (
				part
			),
		);
	};
	return (
		<div
			className={`p-2 rounded text-sm ${className} ${
				status.type === "success"
					? "bg-green-500/10 text-green-600 dark:text-green-400"
					: status.type === "warning"
						? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
						: status.type === "info"
							? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
							: "bg-red-500/10 text-red-600 dark:text-red-400"
			}`}
		>
			{renderMessage(status.message)}
		</div>
	);
}

/** Inline tooltip for dark surfaces */
function DarkTooltip({ text }) {
	return (
		<span className="relative group inline-flex items-center">
			<span className="material-symbols-outlined text-[14px] text-white/35 cursor-help">
				help
			</span>
			<span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-50 w-64 rounded-lg bg-[#111] border border-white/10 text-white/80 text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
				{text}
			</span>
		</span>
	);
}

/** Icon button for dark surfaces */
function DarkIconBtn({ icon, onClick, title, danger, small }) {
	return (
		<button
			onClick={onClick}
			title={title}
			className={`inline-flex items-center justify-center rounded-full transition-colors shrink-0 ${
				small ? "size-7" : "size-9"
			} ${
				danger
					? "hover:bg-red-400/10 text-red-400/70 hover:text-red-400"
					: "hover:bg-white/10 text-white/50 hover:text-white/90"
			}`}
		>
			<span
				className={`material-symbols-outlined ${small ? "text-[14px]" : "text-[18px]"}`}
			>
				{icon}
			</span>
		</button>
	);
}

/** Toggle switch for dark surfaces */
function DarkToggle({ checked, onChange, size = "md", title }) {
	const sizes = {
		sm: { track: "w-8 h-4", thumb: "size-3", translate: "translate-x-4" },
		md: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
	};
	const s = sizes[size] || sizes.md;
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			title={title}
			onClick={() => onChange && onChange(!checked)}
			className={`relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
				checked ? "bg-white" : "bg-white/15"
			} ${s.track}`}
		>
			<span
				className={`pointer-events-none inline-block rounded-full shadow-sm transform transition duration-200 ${
					checked ? s.translate : "translate-x-0.5"
				} ${s.thumb} mt-0.5 ${checked ? "bg-[#1c1c1c]" : "bg-white/80"}`}
			/>
		</button>
	);
}

/** Security warning banner for dark surfaces */
function SecurityWarning({ message, action, dark }) {
	return (
		<div
			className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs ${
				dark
					? "bg-amber-400/5 border-amber-400/15 text-amber-300"
					: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
			}`}
		>
			<span className="material-symbols-outlined text-[16px] shrink-0">
				warning
			</span>
			<p className="flex-1">{message}</p>
			{action && (
				<a
					href={action.href}
					className="font-medium underline shrink-0 hover:opacity-80"
					onClick={
						action.href.startsWith("#")
							? (e) => {
									e.preventDefault();
									document
										.getElementById(action.href.slice(1))
										?.scrollIntoView({
											behavior: "smooth",
										});
								}
							: undefined
					}
				>
					{action.label}
				</a>
			)}
		</div>
	);
}

APIPageClient.propTypes = {
	machineId: PropTypes.string.isRequired,
};
