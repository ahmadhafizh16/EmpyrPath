"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// Provider chips for the brand-panel marquee. Hand-picked to span the
// fallback tiers (subscription / free / cheap) and keep the row visually
// varied. Colors sourced from src/shared/constants/providers.js so the
// marquee stays in sync with the dashboard brand language.
const MARQUEE_PROVIDERS = [
  { name: "Claude Code", color: "#D97757" },
  { name: "Codex", color: "#10A37F" },
  { name: "Gemini", color: "#4285F4" },
  { name: "Kiro AI", color: "#FF6B35" },
  { name: "OpenRouter", color: "#F97316" },
  { name: "GLM", color: "#2563EB" },
  { name: "MiniMax", color: "#FF5B49" },
  { name: "Cursor", color: "#000000" },
  { name: "Copilot", color: "#0969DA" },
  { name: "Cline", color: "#7C3AED" },
  { name: "OpenCode", color: "#E87040" },
  { name: "Vertex AI", color: "#4285F4" },
];

const MIN_PASSWORD_LEN = 6;

export default function LoginPage() {
  // mode: "signin" | "register". Register creates a self-service 'user' account
  // (see /api/auth/register) and on success flips back to signin pre-filled.
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [allowSignup, setAllowSignup] = useState(true);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const router = useRouter();

	// Countdown for rate-limit
	useEffect(() => {
		if (retryAfter <= 0) return;
		const id = setInterval(
			() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)),
			1000,
		);
		return () => clearInterval(id);
	}, [retryAfter]);

	useEffect(() => {
		async function checkAuth() {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000);
			const baseUrl =
				typeof window !== "undefined" ? window.location.origin : "";

			try {
				const res = await fetch(`${baseUrl}/api/auth/status`, {
					signal: controller.signal,
				});
				clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setAllowSignup(data.allowSignup !== false);
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  // Reset transient form state when toggling between sign-in / register.
  const switchMode = (next) => {
    setMode(next);
    setError("");
    setNotice("");
    setResetHint("");
    setPassword("");
    setConfirm("");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      // Email is sent alongside password. The backend tries the users table
      // when an email is present, else falls back to the legacy admin password.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid credentials");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (password.length < MIN_PASSWORD_LEN) {
      setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();

      if (res.ok) {
        // Account created (role: user). Flip to sign-in with email pre-filled.
        setMode("signin");
        setPassword("");
        setConfirm("");
        setNotice("Account created. Sign in to continue.");
      } else {
        setError(data.error || "Registration failed.");
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

	const handleRegister = async (e) => {
		e.preventDefault();
		setError("");
		setNotice("");

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;
  const isRegister = mode === "register";

  // Auth-status loading: keep minimal, on-brand
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas font-display">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-hairline border-t-ink" />
          <span className="text-sm text-steel">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row font-display text-ink">
      {/* Brand identity panel — vibrant product card per DESIGN.md */}
      <aside className="relative flex flex-col justify-between overflow-hidden px-8 py-10 text-white md:w-1/2 md:px-14 md:py-14">
        {/* Animated coral gradient base */}
        <div
          aria-hidden="true"
          className="animate-brand-gradient absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, #ff5b49 0%, #ff7a3d 38%, #e6308a 100%)",
          }}
        />
        {/* Atmospheric depth — radial gradients (DESIGN.md vibrant card pattern) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 18% 88%, rgba(255,255,255,0.20), transparent 55%), radial-gradient(circle at 88% 12%, rgba(0,0,0,0.22), transparent 60%)",
          }}
        />
        {/* Subtle dot grid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.95) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative z-10 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            9Router
          </span>
          <span className="text-xs font-medium tracking-wide text-white/70">
            v0.4.71
          </span>
        </div>

        <div className="relative z-10 my-12">
          <h2 className="text-5xl font-semibold leading-[1.05] tracking-[-0.02em] md:text-6xl">
            One endpoint.
            <br />
            Every model.
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/85">
            Self-hosted AI router. 40+ providers, auto-fallback tiers, and the RTK token saver — never stop coding.
          </p>
        </div>

        {/* Provider marquee — continuous scroll, doubled list for seamless loop.
            aria-hidden so SR users don't hear the duplicated names. */}
        <div
          className="relative z-10 -mx-8 mb-8 overflow-hidden md:-mx-14"
          aria-hidden="true"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)",
          }}
        >
          <p className="px-8 pb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55 md:px-14">
            Compatible with
          </p>
          <div className="flex w-max animate-marquee gap-2.5 pr-2.5">
            {[...MARQUEE_PROVIDERS, ...MARQUEE_PROVIDERS].map((p, i) => (
              <span
                key={`${p.name}-${i}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/95 backdrop-blur"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
              </span>
            ))}
          </div>
        </div>

        <ul className="relative z-10 grid grid-cols-3 gap-3">
          <li className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-2xl font-semibold leading-none">40+</p>
            <p className="mt-1.5 text-xs text-white/75">Providers</p>
          </li>
          <li className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-2xl font-semibold leading-none">100+</p>
            <p className="mt-1.5 text-xs text-white/75">Models</p>
          </li>
          <li className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-2xl font-semibold leading-none">20–40%</p>
            <p className="mt-1.5 text-xs text-white/75">Tokens saved</p>
          </li>
        </ul>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center bg-canvas px-6 py-12 md:px-12">
        <div className="w-full max-w-sm">
          <header className="mb-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-mm-surface px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
              {isRegister ? "Create account" : "Sign in"}
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              {isRegister ? "Get started" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-steel">
              {isRegister
                ? "Create a user account to access the dashboard."
                : authMode === "oidc" && oidcConfigured
                  ? "Continue with your OIDC provider to access the dashboard."
                  : "Sign in to access your dashboard."}
            </p>
          </header>

          <div className="flex flex-col gap-5">
            {!isRegister && oidcAvailable && (
              <button
                type="button"
                onClick={handleOidcLogin}
                className="flex h-11 w-full items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-canvas transition-colors hover:bg-charcoal"
              >
                {oidcLoginLabel}
              </button>
            )}

            {!isRegister && oidcAvailable && passwordAvailable && (
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-stone">
                  or
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            )}

            {notice && (
              <p className="rounded-xl border border-mm-success-text/30 bg-mm-success-bg px-3 py-2 text-xs leading-relaxed text-mm-success-text">
                {notice}
              </p>
            )}

            {(passwordAvailable || isRegister) ? (
              <form
                onSubmit={isRegister ? handleRegister : handleLogin}
                className="flex flex-col gap-4"
              >
                {!isRegister &&
                  ((authMode === "oidc" && !oidcConfigured) ||
                    (authMode === "both" && !oidcConfigured)) && (
                    <p className="rounded-xl bg-mm-surface px-3 py-2 text-xs leading-relaxed text-slate">
                      OIDC is enabled but not yet configured. Password login still works for recovery.
                    </p>
                  )}

                {!isRegister && authMode === "both" && oidcConfigured && (
                  <p className="text-center text-xs text-steel">
                    Password and OIDC login are both enabled.
                  </p>
                )}

                {isRegister && (
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="name"
                      className="text-xs font-semibold uppercase tracking-[0.12em] text-charcoal"
                    >
                      Name <span className="font-normal text-stone">(optional)</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-4 text-sm text-ink outline-none transition-colors placeholder:text-stone focus:border-ink"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="email"
                    className="text-xs font-semibold uppercase tracking-[0.12em] text-charcoal"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required={isRegister}
                    className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-4 text-sm text-ink outline-none transition-colors placeholder:text-stone focus:border-ink"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <label
                      htmlFor="password"
                      className="text-xs font-semibold uppercase tracking-[0.12em] text-charcoal"
                    >
                      Password
                    </label>
                    {!isRegister && hasPassword === false && (
                      <span className="text-[11px] text-stone">
                        Default <code className="font-mono text-charcoal">123456</code>
                      </span>
                    )}
                  </div>
                  <input
                    id="password"
                    type="password"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    placeholder={isRegister ? "At least 6 characters" : "Enter password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={!oidcAvailable}
                    className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-4 text-sm text-ink outline-none transition-colors placeholder:text-stone focus:border-ink"
                  />
                </div>

                {isRegister && (
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="confirm"
                      className="text-xs font-semibold uppercase tracking-[0.12em] text-charcoal"
                    >
                      Confirm password
                    </label>
                    <input
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      className="h-11 w-full rounded-[10px] border border-hairline bg-canvas px-4 text-sm text-ink outline-none transition-colors placeholder:text-stone focus:border-ink"
                    />
                  </div>
                )}

                {error && (
                  <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
                    {error}
                  </p>
                )}

                {!isRegister && retryAfter > 0 && (
                  <p className="text-xs text-slate">
                    Locked. Retry in <span className="font-mono text-ink">{retryAfter}s</span>.
                  </p>
                )}

                {!isRegister && resetHint && (
                  <p className="text-xs leading-relaxed text-steel">
                    Forgot password? Open the{" "}
                    <code className="rounded bg-mm-surface px-1.5 py-0.5 font-mono text-[11px] text-charcoal">
                      9router
                    </code>{" "}
                    CLI on the host →{" "}
                    <b className="font-semibold text-charcoal">Settings</b> →{" "}
                    <b className="font-semibold text-charcoal">
                      Reset Password to Default
                    </b>
                    .
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || (!isRegister && retryAfter > 0)}
                  className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-canvas transition-colors hover:bg-charcoal disabled:cursor-not-allowed disabled:bg-hairline disabled:text-stone"
                >
                  {loading && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />
                  )}
                  {!isRegister && retryAfter > 0
                    ? `Wait ${retryAfter}s`
                    : loading
                      ? isRegister
                        ? "Creating account…"
                        : "Signing in…"
                      : isRegister
                        ? "Create account"
                        : "Sign in"}
                </button>

                {!isRegister && hasPassword === false && (
                  <p className="text-center text-xs text-stone">
                    No custom password is set yet. The default works until you change it.
                  </p>
                )}
              </form>
            ) : (
              error && (
                <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs text-danger">
                  {error}
                </p>
              )
            )}

            {/* Mode toggle — hidden under OIDC-only auth or when signup is disabled. */}
            {authMode !== "oidc" && (allowSignup || isRegister) && (
              <p className="text-center text-xs text-steel">
                {isRegister ? (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className="font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      className="font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      Create one
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          <p className="mt-10 text-center text-xs text-stone">
            One endpoint for all your AI providers.
          </p>
        </div>
      </main>
    </div>
  );
}
