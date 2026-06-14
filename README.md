<div align="center">
  <img src="./public/icons/icon-192.png" alt="Empyr Path" width="120"/>

**One subscription, every AI model.** Subscribe once and reach leading AI models through a single API key — no per-provider accounts, no setup.

</div>

---

## What is this?

Empyr Path is a **consumer-facing AI subscription platform** built on top of [**9Router**](https://github.com/decolua/9router) — the self-hosted AI router that translates request formats, routes across 40+ providers and 100+ models, tracks quota, and refreshes OAuth tokens.

> For the base routing, translation, provider catalog, RTK token saver, and CLI-tool integration, see the **[9Router repository](https://github.com/decolua/9router)** and its documentation. This README only covers what Empyr Path adds on top.

Where 9Router is an operator's tool you point your own coding agent at, Empyr Path wraps that engine in a **multi-tenant subscription product**: an admin defines plans, users sign up and subscribe, and each user gets a metered API key — without ever touching provider connections or routing config.

---

## What Empyr Path adds

### 👥 Multi-user accounts & RBAC

- Email/password accounts with `admin` and `user` roles, on top of 9Router's original single-password login (still works for the bootstrap admin).
- Self-service registration (always creates a `user`; admins are provisioned out-of-band) — gated by an `allowSignup` setting.
- Middleware-level role gating: users only see their own surfaces; admin pages and mutating APIs require `admin`.
- Admin **Users** panel to provision, promote, disable, and delete accounts.

### 🔑 Per-user API keys

- Each key is owned by a user; users see and manage only their own keys.
- **Per-key quota** (`requests`/`tokens`, `day`/`total` window) with day windows that reset at local midnight.
- **Per-key model allowlist** — user-owned keys are **default-deny**: an admin must grant models (or a subscription must cover them) before the key can call anything.
- **My API Key** page: endpoint URL, keys, allowed models/combos, and live quota bars.

### 💳 Subscription plans

- **Admin catalog** (`/dashboard/subscriptions`): create plans with a model set, lifetime **token budget**, **requests/day** limit, duration, price, and a `stackable` flag. The model picker is grouped by provider and supports custom models + combos.
- **User store** (`/dashboard/plans`): browse active plans, attach one to an API key, and request it.
- **Approval flow**: requests land as `pending`; an admin approves (starting the clock: `expiresAt = now + durationDays`) or rejects. Payment gateway is a future drop-in behind the approval step.
- **Independent per-model buckets**: a subscription is its own quota bucket scoped to one key. A request for a model the subscription grants debits that bucket; models outside it fall back to the key's own allowlist + quota.
- **Stackable**: multiple active subscriptions can coexist on one key. Non-stackable plans are rejected at approval if the key already has an active subscription.
- Live budget/request bars surface on both the Plans page and My API Key page.

### 📊 Role-scoped usage view

- The **Usage** page is filtered server-side per role: users see only their own requests (scoped by their API keys — no other users' metadata crosses the wire), with a simplified layout (Volume-over-time + Recent Requests). The full provider topology and usage breakdown stay admin-only.

### 🎨 Dashboard redesign

- Full dashboard restyle.

---

## Run from source

This repository (`9router-app`) is the Next.js app. First-time setup:

```bash
cp .env.example .env
npm install

# Dev (webpack, port 20128)
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

Default URLs:

- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

Requires Node ≥ 20.9 (Node 22+ recommended — the DB layer prefers the built-in `node:sqlite`).

---

## Credits

Built on [**9Router**](https://github.com/decolua/9router) by [decolua](https://github.com/decolua). All base routing, translation, and provider-integration credit belongs upstream — Empyr Path adds the multi-tenant subscription layer described above.
