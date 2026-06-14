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
