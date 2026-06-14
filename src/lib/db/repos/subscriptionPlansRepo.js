import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Admin-defined subscription catalog. CRUD only — no enforcement here; that
// lives in checkApiKeyAccess + saveRequestUsage via userSubscriptionsRepo.

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    models: parseJson(row.models, []),
    tokenBudget: row.tokenBudget ?? null,
    requestsPerDay: row.requestsPerDay ?? null,
    durationDays: row.durationDays,
    priceCents: row.priceCents ?? 0,
    stackable: row.stackable === 1 || row.stackable === true,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPlans({ activeOnly = false } = {}) {
  const db = await getAdapter();
  const where = activeOnly ? `WHERE isActive = 1` : "";
  const rows = db.all(`SELECT * FROM subscriptionPlans ${where} ORDER BY createdAt ASC`);
  return rows.map(rowToPlan);
}

export async function getPlanById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM subscriptionPlans WHERE id = ?`, [id]);
  return rowToPlan(row);
}

// Validate + normalize plan input. Returns { ok, value? , error? }.
// Shared by create/update so both reject the same way.
function normalizePlanInput(data, { partial = false } = {}) {
  const out = {};
  if (data.name != null) {
    const name = String(data.name).trim();
    if (!name) return { ok: false, error: "name is required" };
    out.name = name;
  } else if (!partial) {
    return { ok: false, error: "name is required" };
  }

  if (data.description !== undefined) {
    out.description = data.description == null ? null : String(data.description);
  }

  if (data.models != null) {
    if (!Array.isArray(data.models)) return { ok: false, error: "models must be an array" };
    out.models = data.models.map((m) => String(m)).filter(Boolean);
  } else if (!partial) {
    out.models = [];
  }

  for (const k of ["tokenBudget", "requestsPerDay", "priceCents"]) {
    if (data[k] === undefined) continue;
    if (data[k] === null) { out[k] = null; continue; }
    const n = Number(data[k]);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${k} must be a non-negative number` };
    out[k] = Math.floor(n);
  }

  if (data.durationDays != null) {
    const n = Number(data.durationDays);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "durationDays must be a positive number" };
    out.durationDays = Math.floor(n);
  } else if (!partial) {
    return { ok: false, error: "durationDays is required" };
  }

  if (data.stackable !== undefined) out.stackable = data.stackable ? 1 : 0;
  if (data.isActive !== undefined) out.isActive = data.isActive === false ? 0 : 1;

  return { ok: true, value: out };
}

export async function createPlan(data) {
  const norm = normalizePlanInput(data);
  if (!norm.ok) throw new Error(norm.error);
  const v = norm.value;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.run(
    `INSERT INTO subscriptionPlans(id, name, description, models, tokenBudget, requestsPerDay, durationDays, priceCents, stackable, isActive, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, v.name, v.description ?? null, stringifyJson(v.models || []),
      v.tokenBudget ?? null, v.requestsPerDay ?? null, v.durationDays,
      v.priceCents ?? 0, v.stackable ?? 0, v.isActive ?? 1,
      now, now,
    ]
  );
  return getPlanById(id);
}

export async function updatePlan(id, data) {
  const norm = normalizePlanInput(data, { partial: true });
  if (!norm.ok) throw new Error(norm.error);
  const v = norm.value;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM subscriptionPlans WHERE id = ?`, [id]);
    if (!row) return;
    const merged = {
      ...rowToPlan(row),
      ...v,
      models: v.models ?? parseJson(row.models, []),
      stackable: v.stackable !== undefined ? !!v.stackable : (row.stackable === 1),
      isActive: v.isActive !== undefined ? !!v.isActive : (row.isActive === 1),
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE subscriptionPlans SET
        name = ?, description = ?, models = ?, tokenBudget = ?, requestsPerDay = ?,
        durationDays = ?, priceCents = ?, stackable = ?, isActive = ?, updatedAt = ?
       WHERE id = ?`,
      [
        merged.name, merged.description ?? null, stringifyJson(merged.models || []),
        merged.tokenBudget ?? null, merged.requestsPerDay ?? null, merged.durationDays,
        merged.priceCents ?? 0, merged.stackable ? 1 : 0, merged.isActive ? 1 : 0,
        merged.updatedAt, id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deletePlan(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM subscriptionPlans WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
