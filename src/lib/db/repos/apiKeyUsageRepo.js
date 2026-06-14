import { getAdapter } from "../driver.js";

// Per-key quota counters. Two period rows per key:
//   - day:   periodKey = local 'YYYY-MM-DD' (self-resets on date rollover)
//   - total: periodKey = 'total' (lifetime, never resets)
// Both are incremented on every recorded request so enabling a quota later
// starts enforcing immediately against accurate history.

// Local-date key — must match usageRepo.getLocalDateKey so day windows align
// with the rest of the usage system.
export function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rowToCounter(row) {
  return {
    requests: row?.requests ?? 0,
    tokens: row?.tokens ?? 0,
  };
}

// Read both period counters for a key in one call. Returns zeros for missing
// rows so callers don't branch on existence.
export async function getApiKeyCounters(keyId, timestamp = null) {
  if (!keyId) return { day: { requests: 0, tokens: 0 }, total: { requests: 0, tokens: 0 } };
  const db = await getAdapter();
  const dateKey = getLocalDateKey(timestamp);
  const dayRow = db.get(
    `SELECT requests, tokens FROM apiKeyUsageCounter WHERE keyId = ? AND periodKey = ?`,
    [keyId, dateKey]
  );
  const totalRow = db.get(
    `SELECT requests, tokens FROM apiKeyUsageCounter WHERE keyId = ? AND periodKey = 'total'`,
    [keyId]
  );
  return { day: rowToCounter(dayRow), total: rowToCounter(totalRow) };
}

// Upsert a single (keyId, periodKey) counter by the given deltas. Used inside
// saveRequestUsage's transaction; pass that transaction's db handle so the
// increment is atomic with the usage write.
export function incrementCounterInTx(db, keyId, periodKey, deltaRequests, deltaTokens, now) {
  db.run(
    `INSERT INTO apiKeyUsageCounter(keyId, periodKey, requests, tokens, updatedAt)
       VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(keyId, periodKey) DO UPDATE SET
       requests = requests + excluded.requests,
       tokens = tokens + excluded.tokens,
       updatedAt = excluded.updatedAt`,
    [keyId, periodKey, deltaRequests, deltaTokens, now]
  );
}

// Increment both day + total rows for a key. Standalone (own transaction) —
// used when not already inside a usage-write transaction.
export async function recordApiKeyUsage(keyId, { requests = 1, tokens = 0, timestamp = null } = {}) {
  if (!keyId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const dateKey = getLocalDateKey(timestamp);
  db.transaction(() => {
    incrementCounterInTx(db, keyId, dateKey, requests, tokens, now);
    incrementCounterInTx(db, keyId, "total", requests, tokens, now);
  });
}

// Reset counters for a key (admin action — e.g. after raising a quota). Drops
// all period rows; they re-accrue on the next request.
export async function resetApiKeyUsage(keyId) {
  if (!keyId) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeyUsageCounter WHERE keyId = ?`, [keyId]);
  return (res?.changes ?? 0) > 0;
}
