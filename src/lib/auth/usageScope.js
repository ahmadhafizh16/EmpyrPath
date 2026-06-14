// Resolve the apiKey scope filter for usage views from the dashboard session.
// Admins (and unauthenticated callers — middleware enforces auth elsewhere) get
// the unscoped view (returns null). Users get a Set of their plaintext API keys
// so recentRequests can be filtered server-side without leaking other users'
// metadata over the wire.

import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getApiKeysByUserId } from "@/lib/db/repos/apiKeysRepo.js";

export async function resolveUsageApiKeyFilter() {
  try {
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    if (session?.role !== "user" || !session?.userId) return null;

    const keys = await getApiKeysByUserId(session.userId);
    const set = new Set();
    for (const k of keys) if (k?.key) set.add(k.key);
    return set;
  } catch {
    return null;
  }
}

// Sentinel for a user with zero active keys. Repos turn this into a
// "no rows match" query so the empty case is treated as zero, not as
// an empty `IN ()` (which throws on some drivers).
export const EMPTY_API_KEY_SCOPE = { apiKeys: "EMPTY" };

// Convert a filter object (from resolveUsageApiKeyFilter) into a
// deterministic `IN (?, ?, ...)` clause for a SQLite query.
// Returns { sql, params } where `sql` is "" when the filter is the
// EMPTY sentinel, "1=0" for the empty-set case, or "apiKey IN (?,?)"
// for the populated case. Callers append `sql` to their WHERE clause.
export function buildApiKeyInClause(filter) {
  if (!filter) return { sql: "", params: [] };
  if (filter.apiKeys === "EMPTY") return { sql: "1=0", params: [] };
  if (filter.apiKeys instanceof Set) {
    if (filter.apiKeys.size === 0) return { sql: "1=0", params: [] };
    const params = [...filter.apiKeys];
    return { sql: `apiKey IN (${params.map(() => "?").join(",")})`, params };
  }
  return { sql: "", params: [] };
}

// Convenience: resolve the session scope and turn it into the
// EMPTY sentinel when the user has zero keys. Routes that pass the
// filter straight through to a repo can use this and not worry about
// the "user with no keys" edge case.
export async function resolveUsageApiKeyFilterOrEmpty() {
  const filter = await resolveUsageApiKeyFilter();
  if (filter && filter.size === 0) return EMPTY_API_KEY_SCOPE;
  return filter;
}
