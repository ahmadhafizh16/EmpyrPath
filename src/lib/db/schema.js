// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 1;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  users: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT UNIQUE NOT NULL",
      passwordHash: "TEXT NOT NULL",
      role: "TEXT NOT NULL DEFAULT 'user'",
      name: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    ],
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      // Owning user. NULL = legacy/admin pool (created before per-user keys, or
      // by an admin without an explicit owner) — visible/usable by admins only.
      userId: "TEXT",
      // Quota config — all NULL = unlimited (default). Admin sets these via
      // PATCH /api/keys/[id]/quota. Enforced in checkApiKeyAccess() against
      // the apiKeyUsageCounter table.
      quotaMetric: "TEXT",      // 'tokens' | 'requests' | NULL
      quotaLimit: "INTEGER",    // numeric cap
      quotaWindow: "TEXT",      // 'day' | 'total' | NULL
      // Per-key model allowlist as a JSON array of model ids. NULL = no
      // restriction (admin-style). Empty array '[]' explicitly blocks all.
      // Admin sets via PATCH /api/keys/[id]/allowed-models. Foundation for
      // future subscription tiers (a tier = preset bundle of allowedModels +
      // quota).
      allowedModels: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_user ON apiKeys(userId)",
    ],
  },
  // Per-key, per-period counter for quota enforcement. periodKey is either a
  // local-date string ('YYYY-MM-DD') for window=day or the literal 'total' for
  // window=total. Day rows self-reset by date rollover (a new day = new row).
  // Hot-path lookup is O(1) via the composite primary key.
  apiKeyUsageCounter: {
    columns: {
      keyId: "TEXT NOT NULL",
      periodKey: "TEXT NOT NULL",
      requests: "INTEGER DEFAULT 0",
      tokens: "INTEGER DEFAULT 0",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (keyId, periodKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_akuc_key ON apiKeyUsageCounter(keyId)",
    ],
  },
  // Admin-defined subscription catalog. A plan grants a model set, a lifetime
  // token budget, and a daily request cap for a fixed duration. Users request a
  // plan; an admin approves it (payment gateway is a future seam — priceCents is
  // display-only in v1). models is a JSON array of model ids.
  subscriptionPlans: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT",
      models: "TEXT NOT NULL",            // JSON array of model ids granted
      tokenBudget: "INTEGER",             // total tokens over the lifetime (NULL = unlimited)
      requestsPerDay: "INTEGER",          // daily request cap (NULL = unlimited)
      durationDays: "INTEGER NOT NULL",
      priceCents: "INTEGER DEFAULT 0",    // display only in v1
      stackable: "INTEGER DEFAULT 0",
      isActive: "INTEGER DEFAULT 1",      // hidden from the user catalog when 0
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_sp_active ON subscriptionPlans(isActive)",
    ],
  },
  // Per-user subscription grants. Snapshots the plan's values at request time so
  // later plan edits don't retroactively mutate a live subscription. Each row is
  // an independent quota bucket attached to one API key (keyId). status is
  // pending → active (on approval) → rejected/cancelled; expiry is computed
  // lazily on read (expiresAt < now), not stored.
  userSubscriptions: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      keyId: "TEXT NOT NULL",
      planId: "TEXT",                     // source plan (NULL if plan later deleted)
      models: "TEXT NOT NULL",            // snapshot: JSON array of model ids
      tokenBudget: "INTEGER",             // snapshot
      requestsPerDay: "INTEGER",          // snapshot
      durationDays: "INTEGER NOT NULL",   // snapshot
      stackable: "INTEGER DEFAULT 0",     // snapshot
      status: "TEXT NOT NULL DEFAULT 'pending'", // pending|active|rejected|cancelled
      activatedAt: "TEXT",                // set on approval — clock starts here
      expiresAt: "TEXT",                  // activatedAt + durationDays
      paymentRef: "TEXT",                 // gateway hook (future)
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_us_user ON userSubscriptions(userId)",
      "CREATE INDEX IF NOT EXISTS idx_us_key ON userSubscriptions(keyId)",
      "CREATE INDEX IF NOT EXISTS idx_us_status ON userSubscriptions(status)",
    ],
  },
  // Per-subscription counter. Mirrors apiKeyUsageCounter: periodKey is 'total'
  // (lifetime token budget) or a local-date 'YYYY-MM-DD' (daily request cap,
  // self-resets on date rollover). O(1) hot-path lookup via composite PK.
  subscriptionUsageCounter: {
    columns: {
      subscriptionId: "TEXT NOT NULL",
      periodKey: "TEXT NOT NULL",
      requests: "INTEGER DEFAULT 0",
      tokens: "INTEGER DEFAULT 0",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (subscriptionId, periodKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_suc_sub ON subscriptionUsageCounter(subscriptionId)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",                  // real served model (e.g. "mimo-v2.5-pro")
      // User-facing label when different from `model` — currently set to the
      // combo name when this request was a resolved combo member. NULL for
      // direct calls. The user-scoped recent-requests view substitutes this in
      // place of `model`; admins always see the real `model`. Pricing/cost
      // lookups, byModel breakdowns, and provider stats all use `model`.
      requestedModel: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
