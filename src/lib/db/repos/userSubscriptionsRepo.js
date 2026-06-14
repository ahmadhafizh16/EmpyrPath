import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getLocalDateKey } from "./apiKeyUsageRepo.js";

// Per-user subscription grants + the enforcement-support core. Each row is an
// independent quota bucket attached to one API key. The sync helpers
// (computeModelGrant, debitSubscriptionInTx) take a db handle so they can run
// inside saveRequestUsage's transaction; async wrappers resolve the adapter.

function rowToSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    keyId: row.keyId,
    planId: row.planId || null,
    models: parseJson(row.models, []),
    tokenBudget: row.tokenBudget ?? null,
    requestsPerDay: row.requestsPerDay ?? null,
    durationDays: row.durationDays,
    stackable: row.stackable === 1 || row.stackable === true,
    status: row.status,
    activatedAt: row.activatedAt || null,
    expiresAt: row.expiresAt || null,
    paymentRef: row.paymentRef || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Sync enforcement core (db handle passed in) ─────────────────────────

function queryActiveSubs(db, keyId, nowIso) {
  const rows = db.all(
    `SELECT * FROM userSubscriptions
       WHERE keyId = ? AND status = 'active' AND (expiresAt IS NULL OR expiresAt > ?)
       ORDER BY expiresAt ASC`,
    [keyId, nowIso]
  );
  return rows.map(rowToSubscription);
}

function readSubCounters(db, subId, dateKey) {
  const totalRow = db.get(
    `SELECT tokens FROM subscriptionUsageCounter WHERE subscriptionId = ? AND periodKey = 'total'`,
    [subId]
  );
  const dayRow = db.get(
    `SELECT requests FROM subscriptionUsageCounter WHERE subscriptionId = ? AND periodKey = ?`,
    [subId, dateKey]
  );
  return { totalTokens: totalRow?.tokens ?? 0, dayRequests: dayRow?.requests ?? 0 };
}

// Strip the provider-alias prefix from a model string: "kr/claude-opus-4.7" →
// "claude-opus-4.7". The first "/" separates the single-segment alias from the
// model id; combos (no "/") pass through unchanged.
function stripAlias(s) {
  if (typeof s !== "string") return s;
  const i = s.indexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}

// Match a subscription's stored model entry against the request's model string.
// The plan picker stores provider-prefixed values ("kr/claude-opus-4.7") but the
// request hot path resolves to a bare id ("claude-opus-4.7") before the usage
// write, so compare on the bare id after an exact-match fast path. Matching by
// bare id (not provider+id) is consistent with usageHistory, which also tracks
// models without a provider distinction.
function modelMatches(entry, requested) {
  if (entry === requested) return true;
  return stripAlias(entry) === stripAlias(requested);
}

// Does this subscription grant the requested model? Two paths:
//  1. Direct match — covers (a) the access check when the user calls a combo
//     name, (b) bare-model entries vs alias-prefixed requests, (c) vice versa.
//  2. Combo expansion — when the user calls a combo, the combo dispatcher
//     resolves to a member model BEFORE the usage write, so the debit sees the
//     resolved id (e.g. "mimo-v2.5-pro"), not "combo1". For each subscription
//     entry without a "/" (combo-name shape) we look up the combo and check its
//     members. The combos.name index makes this an O(1) lookup per entry.
function subscriptionGrantsModel(db, subModels, requested) {
  if (subModels.some((m) => modelMatches(m, requested))) return true;
  for (const entry of subModels) {
    if (typeof entry !== "string" || entry.includes("/")) continue;
    const row = db.get(`SELECT models FROM combos WHERE name = ?`, [entry]);
    if (!row) continue;
    const members = parseJson(row.models, []);
    if (Array.isArray(members) && members.some((m) => modelMatches(m, requested))) return true;
  }
  return false;
}

// Resolve a model against the key's active subscriptions. Returns the aggregate
// remaining budget across all buckets granting the model, plus the bucket to
// debit (soonest-expiry with token budget left → use-it-or-lose-it). A null
// budget/requestsPerDay means unlimited (Infinity sums cleanly).
function computeModelGrant(db, keyId, model, timestamp) {
  const nowIso = (timestamp ? new Date(timestamp) : new Date()).toISOString();
  const dateKey = getLocalDateKey(timestamp);
  const subs = queryActiveSubs(db, keyId, nowIso).filter(
    (s) => Array.isArray(s.models) && subscriptionGrantsModel(db, s.models, model)
  );
  if (subs.length === 0) {
    return { granted: false, hasSubscription: false, tokenRemaining: 0, dayReqRemaining: 0, debitId: null };
  }

  let tokenRemaining = 0;
  let dayReqRemaining = 0;
  let debitId = null;
  for (const s of subs) {
    const c = readSubCounters(db, s.id, dateKey);
    const tRem = s.tokenBudget == null ? Infinity : Math.max(0, s.tokenBudget - c.totalTokens);
    const rRem = s.requestsPerDay == null ? Infinity : Math.max(0, s.requestsPerDay - c.dayRequests);
    tokenRemaining += tRem;
    dayReqRemaining += rRem;
    if (debitId === null && tRem > 0) debitId = s.id; // soonest-expiry with budget
  }
  if (debitId === null) debitId = subs[0].id; // all token-exhausted → still debit soonest

  return {
    granted: tokenRemaining > 0 && dayReqRemaining > 0,
    hasSubscription: true,
    tokenRemaining,
    dayReqRemaining,
    debitId,
  };
}

function incrementSubCounterInTx(db, subId, periodKey, deltaRequests, deltaTokens, now) {
  db.run(
    `INSERT INTO subscriptionUsageCounter(subscriptionId, periodKey, requests, tokens, updatedAt)
       VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(subscriptionId, periodKey) DO UPDATE SET
       requests = requests + excluded.requests,
       tokens = tokens + excluded.tokens,
       updatedAt = excluded.updatedAt`,
    [subId, periodKey, deltaRequests, deltaTokens, now]
  );
}

// Debit a bucket: 'total' row holds the lifetime token budget; the daily row
// holds the per-day request cap. Both rows track both metrics for display.
function debitSubscriptionInTx(db, subId, { requests = 1, tokens = 0, timestamp = null } = {}) {
  const now = new Date().toISOString();
  const dateKey = getLocalDateKey(timestamp);
  incrementSubCounterInTx(db, subId, "total", requests, tokens, now);
  incrementSubCounterInTx(db, subId, dateKey, requests, tokens, now);
}

// Exported sync entry points for usageRepo's transaction.
export { computeModelGrant as computeModelGrantInTx, debitSubscriptionInTx };

// ─── Async read API ──────────────────────────────────────────────────────

export async function getEffectiveModelGrant(keyId, model, timestamp = null) {
  if (!keyId || !model) return { granted: false, hasSubscription: false, debitId: null };
  const db = await getAdapter();
  return computeModelGrant(db, keyId, model, timestamp);
}

// Active, non-expired subscriptions for a key — enriched with current usage so
// the My API Key UI can render budget/request bars without a second round trip.
export async function getActiveSubscriptionsForKey(keyId, timestamp = null) {
  if (!keyId) return [];
  const db = await getAdapter();
  const nowIso = (timestamp ? new Date(timestamp) : new Date()).toISOString();
  const dateKey = getLocalDateKey(timestamp);
  return queryActiveSubs(db, keyId, nowIso).map((s) => {
    const c = readSubCounters(db, s.id, dateKey);
    return { ...s, usedTokens: c.totalTokens, usedRequestsToday: c.dayRequests };
  });
}

export async function getSubscriptionsByUser(userId) {
  if (!userId) return [];
  const db = await getAdapter();
  const dateKey = getLocalDateKey();
  const rows = db.all(
    `SELECT * FROM userSubscriptions WHERE userId = ? ORDER BY createdAt DESC`,
    [userId]
  );
  // Enrich every row with current counters so the UI can render usage bars
  // without a second round trip. Active rows use today's date key for the daily
  // counter; pending/rejected/cancelled rows still report any counters that
  // happen to exist (always 0 for never-active rows).
  return rows.map(rowToSubscription).map((s) => {
    const c = readSubCounters(db, s.id, dateKey);
    return { ...s, usedTokens: c.totalTokens, usedRequestsToday: c.dayRequests };
  });
}

export async function getPendingSubscriptions() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM userSubscriptions WHERE status = 'pending' ORDER BY createdAt ASC`
  );
  return rows.map(rowToSubscription);
}

export async function getSubscriptionById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM userSubscriptions WHERE id = ?`, [id]);
  return rowToSubscription(row);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

// User requests a plan against one of their keys. Snapshots the plan so later
// edits don't mutate the live grant. Created as 'pending' (admin approves).
export async function requestSubscription({ userId, keyId, plan }) {
  if (!userId || !keyId || !plan) throw new Error("userId, keyId and plan are required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.run(
    `INSERT INTO userSubscriptions(
       id, userId, keyId, planId, models, tokenBudget, requestsPerDay,
       durationDays, stackable, status, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id, userId, keyId, plan.id || null, stringifyJson(plan.models || []),
      plan.tokenBudget ?? null, plan.requestsPerDay ?? null, plan.durationDays,
      plan.stackable ? 1 : 0, now, now,
    ]
  );
  return getSubscriptionById(id);
}

// Returns true if the key has any active, non-expired subscription. Used to
// block approving a non-stackable plan while another grant is live.
function hasActiveSubscription(db, keyId, nowIso) {
  const row = db.get(
    `SELECT 1 FROM userSubscriptions
       WHERE keyId = ? AND status = 'active' AND (expiresAt IS NULL OR expiresAt > ?)
       LIMIT 1`,
    [keyId, nowIso]
  );
  return !!row;
}

// Admin approval — starts the clock. A non-stackable subscription is rejected
// when the key already has an active grant. Returns { ok, error?, subscription? }.
export async function approveSubscription(id) {
  const db = await getAdapter();
  let result = { ok: false, error: "not_found" };
  db.transaction(() => {
    const row = db.get(`SELECT * FROM userSubscriptions WHERE id = ?`, [id]);
    if (!row) return;
    if (row.status !== "pending") {
      result = { ok: false, error: `cannot approve a ${row.status} subscription` };
      return;
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const stackable = row.stackable === 1 || row.stackable === true;
    if (!stackable && hasActiveSubscription(db, row.keyId, nowIso)) {
      result = { ok: false, error: "non_stackable_conflict" };
      return;
    }
    const expires = new Date(now.getTime() + row.durationDays * 24 * 60 * 60 * 1000).toISOString();
    db.run(
      `UPDATE userSubscriptions SET status = 'active', activatedAt = ?, expiresAt = ?, updatedAt = ? WHERE id = ?`,
      [nowIso, expires, nowIso, id]
    );
    result = { ok: true, subscription: rowToSubscription({ ...row, status: "active", activatedAt: nowIso, expiresAt: expires, updatedAt: nowIso }) };
  });
  return result;
}

// Set status to rejected/cancelled. Caller enforces who may do this.
export async function setSubscriptionStatus(id, status) {
  if (!["rejected", "cancelled"].includes(status)) throw new Error("invalid status transition");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const res = db.run(
    `UPDATE userSubscriptions SET status = ?, updatedAt = ? WHERE id = ?`,
    [status, now, id]
  );
  return (res?.changes ?? 0) > 0;
}
