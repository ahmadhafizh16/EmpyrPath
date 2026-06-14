import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  let allowedModels = null;
  if (row.allowedModels) {
    try {
      const parsed = JSON.parse(row.allowedModels);
      if (Array.isArray(parsed)) allowedModels = parsed;
    } catch {
      // Corrupt JSON → treat as no restriction. Logged elsewhere if needed.
    }
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    userId: row.userId || null,
    quotaMetric: row.quotaMetric || null,
    quotaLimit: row.quotaLimit ?? null,
    quotaWindow: row.quotaWindow || null,
    allowedModels,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

// Owner-scoped list. Used by /api/keys for role=user and by the per-user UI.
export async function getApiKeysByUserId(userId) {
  if (!userId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM apiKeys WHERE userId = ? ORDER BY createdAt ASC`,
    [userId]
  );
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Object-form signature; positional (name, machineId) kept for back-compat.
// userId is optional — admin-pool keys (legacy / pre-migration) may have NULL.
export async function createApiKey(nameOrOpts, machineIdArg) {
  const opts =
    typeof nameOrOpts === "object" && nameOrOpts !== null
      ? nameOrOpts
      : { name: nameOrOpts, machineId: machineIdArg };
  const { name, machineId, userId = null } = opts;
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    userId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, userId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, apiKey.userId, 1, apiKey.createdAt]
  );
  return apiKey;
}

// Idempotent default-key issuer for the registration flow.
// Returns the existing first key for the user if any; otherwise mints one.
// Failure to mint is the caller's responsibility — register should swallow.
export async function getOrCreateUserApiKey(userId, name = "Default") {
  if (!userId) throw new Error("userId is required");
  const existing = await getApiKeysByUserId(userId);
  if (existing.length > 0) return existing[0];
  const { getConsistentMachineId } = await import("@/shared/utils/machineId");
  const machineId = await getConsistentMachineId();
  return createApiKey({ name, machineId, userId });
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

// Structured access check for the LLM chokepoint. Distinct from validateApiKey
// (which stays a bool for its other callers) — returns a reason so the handler
// can map to the right status code:
//   reason 'not_found' / 'inactive' → 401
//   reason 'quota_exceeded' / 'quota_required' → 429 / 403
//   reason 'model_not_allowed'      → 403
// `ok: true` means the request may proceed.
//
// Defaults are ROLE-AWARE:
//   - Admin keys (userId NULL = legacy/admin pool, or owner role=admin) default
//     to UNLIMITED: NULL allowlist = any model, no quota = uncapped.
//   - User keys (owned by a role=user account) default-DENY: NULL/empty
//     allowlist = no models ('model_not_allowed'), no quota = blocked
//     ('quota_required'). An admin must explicitly grant models + a quota.
export async function checkApiKeyAccess(key, { timestamp = null, model = null } = {}) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT id, userId, isActive, quotaMetric, quotaLimit, quotaWindow, allowedModels FROM apiKeys WHERE key = ?`,
    [key]
  );
  if (!row) return { ok: false, reason: "not_found", key: null };
  const isActive = row.isActive === 1 || row.isActive === true;
  if (!isActive) return { ok: false, reason: "inactive", key: rowToKey(row) };

  // Admin key = no owner (legacy/admin pool) OR owner is a role=admin account.
  // Only user-owned keys are subject to default-deny.
  let isAdminKey = !row.userId;
  if (row.userId) {
    const owner = db.get(`SELECT role FROM users WHERE id = ?`, [row.userId]);
    isAdminKey = owner?.role === "admin";
  }

  // Subscription override: if an active subscription on this key grants the
  // requested model, it governs both access AND quota for that model — the
  // key-level allowlist + quota do not apply. Models not covered by any active
  // sub fall through to the existing key-level checks below. Sync helper runs
  // a few indexed lookups; cheap to call inline here.
  if (model) {
    const { computeModelGrantInTx } = await import("./userSubscriptionsRepo.js");
    const grant = computeModelGrantInTx(db, row.id, model, timestamp);
    if (grant.hasSubscription) {
      if (!grant.granted) {
        return {
          ok: false,
          reason: "subscription_exhausted",
          key: rowToKey(row),
          subscription: {
            tokenRemaining: grant.tokenRemaining === Infinity ? null : grant.tokenRemaining,
            dayReqRemaining: grant.dayReqRemaining === Infinity ? null : grant.dayReqRemaining,
          },
        };
      }
      return {
        ok: true,
        reason: null,
        key: rowToKey(row),
        via: "subscription",
        subscriptionId: grant.debitId,
      };
    }
  }

  // Model allowlist — checked before quota so a forbidden model doesn't burn
  // a counter increment. Caller passes null when the model is irrelevant
  // (e.g. control-plane validations); we skip the check then.
  if (model) {
    let allowed = null;
    if (row.allowedModels) {
      try {
        const parsed = JSON.parse(row.allowedModels);
        if (Array.isArray(parsed)) allowed = parsed;
      } catch {
        // Corrupt JSON → treat as "no allowlist". For a user key that means
        // deny-all (consistent with default-deny); admin keys stay unrestricted.
      }
    }
    if (allowed === null) {
      // No allowlist configured. Admin key → any model; user key → none.
      if (!isAdminKey) {
        return {
          ok: false,
          reason: "model_not_allowed",
          key: rowToKey(row),
          allowedModels: [],
          requestedModel: model,
        };
      }
    } else if (!allowed.includes(model)) {
      return {
        ok: false,
        reason: "model_not_allowed",
        key: rowToKey(row),
        allowedModels: allowed,
        requestedModel: model,
      };
    }
  }

  const metric = row.quotaMetric;
  const limit = row.quotaLimit;
  const window = row.quotaWindow;
  const hasQuota = metric && limit != null && window;
  if (!hasQuota) {
    // Admin key → uncapped. User key → must have a quota assigned first.
    if (isAdminKey) return { ok: true, reason: null, key: rowToKey(row) };
    return { ok: false, reason: "quota_required", key: rowToKey(row) };
  }

  const { getApiKeyCounters } = await import("./apiKeyUsageRepo.js");
  const counters = await getApiKeyCounters(row.id, timestamp);
  const period = window === "day" ? counters.day : counters.total;
  const used = metric === "tokens" ? period.tokens : period.requests;
  if (used >= limit) {
    return {
      ok: false,
      reason: "quota_exceeded",
      key: rowToKey(row),
      quota: { metric, limit, window, used },
    };
  }
  return { ok: true, reason: null, key: rowToKey(row) };
}

// Admin: set or clear a key's quota. Pass all-null to make the key unlimited.
export async function setApiKeyQuota(id, { quotaMetric = null, quotaLimit = null, quotaWindow = null } = {}) {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE apiKeys SET quotaMetric = ?, quotaLimit = ?, quotaWindow = ? WHERE id = ?`,
    [quotaMetric, quotaLimit, quotaWindow, id]
  );
  if ((res?.changes ?? 0) === 0) return null;
  return getApiKeyById(id);
}

// Admin: set or clear a key's allowed-models list. Pass null (or omit) to
// remove the restriction; pass an array (possibly empty) to enforce one.
// Non-array / non-string values are coerced to an empty list rather than
// rejected so the caller can pass through user input loosely.
export async function setApiKeyAllowedModels(id, models) {
  let payload = null;
  if (Array.isArray(models)) {
    const normalized = models
      .map((m) => (typeof m === "string" ? m.trim() : ""))
      .filter(Boolean);
    payload = JSON.stringify([...new Set(normalized)]);
  }
  const db = await getAdapter();
  const res = db.run(
    `UPDATE apiKeys SET allowedModels = ? WHERE id = ?`,
    [payload, id]
  );
  if ((res?.changes ?? 0) === 0) return null;
  return getApiKeyById(id);
}
