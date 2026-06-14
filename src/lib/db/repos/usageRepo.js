import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";
import { incrementCounterInTx, getLocalDateKey as getCounterDateKey } from "./apiKeyUsageRepo.js";
import { computeModelGrantInTx, debitSubscriptionInTx } from "./userSubscriptionsRepo.js";
import { buildApiKeyInClause, EMPTY_API_KEY_SCOPE } from "@/lib/auth/usageScope.js";

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;

export const statsEmitter = global._statsEmitter;

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

// Build the `WHERE apiKey IN (...)` clause for a user-scoped read.
// `filter` is the object shape produced by resolveUsageApiKeyFilter —
// either null (admin / unscoped), a non-empty Set (scoped), an empty
// Set (user with no keys), or the EMPTY_API_KEY_SCOPE sentinel.
// Returns "" for unscoped, "AND apiKey IN (?,...)" or "AND 1=0" for
// scoped. Callers compose the leading " AND " themselves.
function bindApiKeys(filter, joiner = " AND ") {
  if (!filter) return { sql: "", params: [] };
  const { sql, params } = buildApiKeyInClause(filter);
  return { sql: sql ? `${joiner}${sql}` : "", params };
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, requestedModel, connectionId, apiKey, endpoint, cost, status, tokens, meta FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => {
      const meta = parseJson(r.meta, {}) || {};
      return {
        timestamp: r.timestamp, provider: r.provider, model: r.model, requestedModel: r.requestedModel || null, connectionId: r.connectionId,
        apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
        tokens: parseJson(r.tokens, {}),
        latency: meta.latency || null,
      };
    });
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    cost += nonCachedInput * (pricing.input / 1000000);

    if (cachedTokens > 0) {
      const cachedRate = pricing.cached || pricing.input;
      cost += cachedTokens * (cachedRate / 1000000);
    }

    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += outputTokens * (pricing.output / 1000000);

    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const rate = pricing.reasoning || pricing.output;
      cost += reasoningTokens * (rate / 1000000);
    }

    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const rate = pricing.cache_creation || pricing.input;
      cost += cacheCreationTokens * (rate / 1000000);
    }

    return cost;
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      statsEmitter.emit("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  const t = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`);
  statsEmitter.emit("pending");
}

export async function getActiveRequests(filter = {}) {
  // apiKeys: Set<string> of plaintext keys that scope recentRequests to a user.
  // Undefined → admin view (no scoping). activeRequests has no apiKey
  // association (keyed by connectionId+model), so we suppress it for scoped callers.
  const apiKeyFilter = filter.apiKeys instanceof Set ? filter.apiKeys : null;
  const activeRequests = [];

  if (!apiKeyFilter) {
    const connectionMap = await getConnectionMapCached();
    for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
      for (const [modelKey, count] of Object.entries(models)) {
        if (count > 0) {
          const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
          const match = modelKey.match(/^(.*) \((.*)\)$/);
          activeRequests.push({
            model: match ? match[1] : modelKey,
            provider: match ? match[2] : "unknown",
            account: accountName, count,
          });
        }
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .filter((e) => !apiKeyFilter || (e.apiKey && apiKeyFilter.has(e.apiKey)))
    .map((e) => {
      const t = e.tokens || {};
      // User-scoped view sees the requested label (combo name) when present;
      // admin view always sees the real served model. Pricing/breakdowns key
      // off the real model regardless.
      const displayModel = apiKeyFilter ? (e.requestedModel || e.model) : e.model;
      return {
        timestamp: e.timestamp, model: displayModel, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        latency: e.latency || null,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, requestedModel, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null, entry.requestedModel || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens),
          stringifyJson(entry.latency ? { latency: entry.latency } : {}),
        ]
      );

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);

      // Per-key quota counters: increment day + total rows atomically with the
      // usage write. Resolves keyId from the plaintext apiKey via idx_ak_key
      // (one indexed lookup). Untracked keys (no row) are skipped silently —
      // requests without an apiKey, or with an apiKey not in the table, don't
      // accrue against any quota and don't need to.
      if (entry.apiKey) {
        const keyRow = db.get(`SELECT id FROM apiKeys WHERE key = ?`, [entry.apiKey]);
        if (keyRow?.id) {
          const counterDate = getCounterDateKey(entry.timestamp);
          const tokenDelta = promptTokens + completionTokens;
          incrementCounterInTx(db, keyRow.id, counterDate, 1, tokenDelta, entry.timestamp);
          incrementCounterInTx(db, keyRow.id, "total", 1, tokenDelta, entry.timestamp);

          // Subscription debit: if an active bucket grants the served model,
          // drain it atomically with the usage write. We re-resolve here (rather
          // than threading subscriptionId from the access check) because combos
          // can route to a different model than the user requested — the served
          // entry.model is the source of truth. computeModelGrantInTx returns
          // the soonest-expiry bucket with token budget remaining (use-it-or-
          // lose-it). If no bucket grants the model, this is a no-op and the
          // request was governed by the key-level quota above.
          if (entry.model) {
            const grant = computeModelGrantInTx(db, keyRow.id, entry.model, entry.timestamp);
            if (grant.hasSubscription && grant.debitId) {
              debitSubscriptionInTx(db, grant.debitId, { requests: 1, tokens: tokenDelta, timestamp: entry.timestamp });
            }
          }
        }
      }
    });

    pushToRing(entry);
    statsEmitter.emit("update");
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const scope = bindApiKeys(filter, " AND ");
  if (scope.sql) { conds.push(scope.sql.replace(/^ AND /, "")); params.push(...scope.params); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKey: r.apiKey, endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
  }));
}

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

export async function getUsageStats(period = "all", filter = {}) {
  const db = await getAdapter();
  // apiKeys: Set<string> of plaintext keys scoping recentRequests to one user.
  const apiKeyFilter = filter.apiKeys instanceof Set ? filter.apiKeys : null;

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // recentRequests from live history. Pull a wider window when filtering by
  // apiKey so a low-volume user still sees enough rows after the scope filter.
  const recentLimit = apiKeyFilter ? 500 : 100;
  const recentRows = db.all(`SELECT timestamp, provider, model, requestedModel, apiKey, tokens, status, meta FROM usageHistory ORDER BY id DESC LIMIT ?`, [recentLimit]);
  const seen = new Set();
  const recentRequests = recentRows
    .filter((r) => !apiKeyFilter || (r.apiKey && apiKeyFilter.has(r.apiKey)))
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      const m = parseJson(r.meta, {}) || {};
      // User-scoped view sees the requested label (combo name) when present;
      // admin view always sees the real served model.
      const displayModel = apiKeyFilter ? (r.requestedModel || r.model) : r.model;
      return {
        timestamp: r.timestamp, model: displayModel, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        latency: m.latency || null,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — query 10min window, scoped to the user's apiKeys
  // when a filter is present. Always 10 zero-initialized buckets so the
  // chart has a stable shape even when the user has no traffic.
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const last10Scope = bindApiKeys(filter, " AND ");
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?${last10Scope.sql}`,
    [tenMinutesAgo.toISOString(), now.toISOString(), ...last10Scope.params]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;

    if (filter) {
      // Scoped path: usageDaily is per-instance and has no per-user
      // breakdown. Re-aggregate from usageHistory with the apiKey
      // predicate so the user only sees their own traffic. The admin
      // (unscoped) path keeps the cheap usageDaily iteration below.
      const cutoff = new Date();
      if (maxDays != null) cutoff.setDate(cutoff.getDate() - maxDays + 1);
      cutoff.setHours(0, 0, 0, 0);
      const scope = bindApiKeys(filter, " AND ");
      const rows = db.all(
        `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?${scope.sql}`,
        [cutoff.toISOString(), ...scope.params]
      );
      aggregateHistoryRows(rows, stats, {
        connectionMap, providerNodeNameMap, apiKeyMap, filter,
      });
    } else {
      const dayRows = loadDaysInRange(db, maxDays);

      for (const dr of dayRows) {
        const dateKey = dr.dateKey;
        const day = parseJson(dr.data, {});
        stats.totalPromptTokens += day.promptTokens || 0;
        stats.totalCompletionTokens += day.completionTokens || 0;
        stats.totalCost += day.cost || 0;

        for (const [prov, p] of Object.entries(day.byProvider || {})) {
          if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
          stats.byProvider[prov].requests += p.requests || 0;
          stats.byProvider[prov].promptTokens += p.promptTokens || 0;
          stats.byProvider[prov].completionTokens += p.completionTokens || 0;
          stats.byProvider[prov].cost += p.cost || 0;
        }

        for (const [mk, m] of Object.entries(day.byModel || {})) {
          const rawModel = m.rawModel || mk.split("|")[0];
          const provider = m.provider || mk.split("|")[1] || "";
          const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
          const providerDisplayName = providerNodeNameMap[provider] || provider;
          if (!stats.byModel[statsKey]) {
            stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
          }
          stats.byModel[statsKey].requests += m.requests || 0;
          stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
          stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
          stats.byModel[statsKey].cost += m.cost || 0;
          if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
        }

        for (const [connId, a] of Object.entries(day.byAccount || {})) {
          const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
          const rawModel = a.rawModel || "";
          const provider = a.provider || "";
          const providerDisplayName = providerNodeNameMap[provider] || provider;
          const accountKey = `${rawModel} (${provider} - ${accountName})`;
          if (!stats.byAccount[accountKey]) {
            stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
          }
          stats.byAccount[accountKey].requests += a.requests || 0;
          stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
          stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
          stats.byAccount[accountKey].cost += a.cost || 0;
          if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
        }

        for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
          const rawModel = ak.rawModel || "";
          const provider = ak.provider || "";
          const providerDisplayName = providerNodeNameMap[provider] || provider;
          const apiKeyVal = ak.apiKey;
          const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
          const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
          const apiKeyKey = apiKeyVal || "local-no-key";
          if (!stats.byApiKey[akKey]) {
            stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKey: apiKeyVal, keyName, apiKeyKey, lastUsed: dateKey };
          }
          stats.byApiKey[akKey].requests += ak.requests || 0;
          stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
          stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
          stats.byApiKey[akKey].cost += ak.cost || 0;
          if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
        }

        for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
          const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
          const rawModel = ep.rawModel || "";
          const provider = ep.provider || "";
          const providerDisplayName = providerNodeNameMap[provider] || provider;
          if (!stats.byEndpoint[epKey]) {
            stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
          }
          stats.byEndpoint[epKey].requests += ep.requests || 0;
          stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
          stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
          stats.byEndpoint[epKey].cost += ep.cost || 0;
          if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
        }
      }
    }

    // Overlay precise lastUsed timestamps from history. Scoped to
    // the user's apiKey set when a filter is present so we don't
    // claim a model is "last used" by the user when it was someone
    // else.
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const overlayScope = bindApiKeys(filter, " AND ");
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?${overlayScope.sql}`,
      [new Date(overlayCutoff).toISOString(), ...overlayScope.params]
    );
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
      }

      const apiKeyKey = (e.apiKey && typeof e.apiKey === "string")
        ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const scope = bindApiKeys(filter, " AND ");
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?${scope.sql}`,
      [cutoff, ...scope.params]
    );
    aggregateHistoryRows(filtered, stats, {
      connectionMap, providerNodeNameMap, apiKeyMap, filter,
    });
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

// Aggregate usageHistory rows into the same `stats` shape that the
// daily-summary branch produces (totalCounts, byProvider, byModel,
// byAccount, byApiKey, byEndpoint, lastUsed). Used by the
// user-scoped 24h/today path and the user-scoped daily-summary
// fallback. Admin paths still iterate usageDaily for cheap reads.
function aggregateHistoryRows(rows, stats, { connectionMap, providerNodeNameMap, apiKeyMap, filter }) {
  // For the user-scoped read, the apiKey filter is already enforced
  // at the SQL layer; this in-memory guard is a no-op. For the
  // admin path (filter is null) it's also a no-op.
  const apiKeySet = filter?.apiKeys instanceof Set ? filter.apiKeys : null;

  for (const r of rows) {
    if (apiKeySet && (!r.apiKey || !apiKeySet.has(r.apiKey))) continue;
    const tokens = parseJson(r.tokens, {}) || {};
    const promptTokens = tokens.prompt_tokens || 0;
    const completionTokens = tokens.completion_tokens || 0;
    const entryCost = r.cost || 0;
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCost += entryCost;

    if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.byProvider[r.provider].requests++;
    stats.byProvider[r.provider].promptTokens += promptTokens;
    stats.byProvider[r.provider].completionTokens += completionTokens;
    stats.byProvider[r.provider].cost += entryCost;

    const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;
    stats.byModel[modelKey].cost += entryCost;
    if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

    if (r.connectionId) {
      const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
      const accountKey = `${r.model} (${r.provider} - ${accountName})`;
      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
      stats.byAccount[accountKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
    }

    if (r.apiKey && typeof r.apiKey === "string") {
      const keyInfo = apiKeyMap[r.apiKey];
      const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
      const akKey = `${r.apiKey}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: r.apiKey, keyName, apiKeyKey: r.apiKey, lastUsed: r.timestamp };
      }
      const ake = stats.byApiKey[akKey];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cost += entryCost;
      if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
    } else {
      if (!stats.byApiKey["local-no-key"]) {
        stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
      }
      const ake = stats.byApiKey["local-no-key"];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cost += entryCost;
      if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
    }

    const endpoint = r.endpoint || "Unknown";
    const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    if (!stats.byEndpoint[epKey]) {
      stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
    }
    const epe = stats.byEndpoint[epKey];
    epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cost += entryCost;
    if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
  }
}

export async function getChartData(period = "7d", filter = {}) {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const scope = bindApiKeys(filter, " AND ");
    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?${scope.sql}`,
      [new Date(startTime).toISOString(), ...scope.params]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const scope = bindApiKeys(filter, " AND ");
    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?${scope.sql}`,
      [new Date(startTime).toISOString(), ...scope.params]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data. For scoped callers, scan
  // usageHistory within the same date range so the chart only shows
  // the user's traffic. usageDaily is per-instance, not per-user.
  const dayMap = {};
  if (filter) {
    const scope = bindApiKeys(filter, " AND ");
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (bucketCount - 1));
    cutoff.setHours(0, 0, 0, 0);
    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?${scope.sql}`,
      [cutoff.toISOString(), ...scope.params]
    );
    for (const r of rows) {
      const ts = new Date(r.timestamp);
      const dKey = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      if (!dayMap[dKey]) dayMap[dKey] = { promptTokens: 0, completionTokens: 0, cost: 0 };
      dayMap[dKey].promptTokens += r.promptTokens || 0;
      dayMap[dKey].completionTokens += r.completionTokens || 0;
      dayMap[dKey].cost += r.cost || 0;
    }
  } else {
    const dayRows = loadDaysInRange(db, bucketCount);
    for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});
  }

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200, filter = {}) {
  try {
    const db = getAdapter();
    const scope = bindApiKeys(filter, " AND ");
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ${scope.sql ? `WHERE 1=1${scope.sql}` : ""} ORDER BY id DESC LIMIT ?`,
      [...scope.params, limit],
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}
