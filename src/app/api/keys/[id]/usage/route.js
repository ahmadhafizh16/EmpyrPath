import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiKeyById, getApiKeyCounters } from "@/lib/db/index.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

async function getSessionContext() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (!session) return { role: null, userId: null };
  if (session.role === "admin" || session.role === "user") {
    return { role: session.role, userId: session.userId || null };
  }
  if (session.authenticated) return { role: "admin", userId: null };
  return { role: null, userId: null };
}

// GET /api/keys/[id]/usage
//   Returns the per-key counters (day + total) plus the configured quota for
//   convenience — the user's UI renders "used / limit" and the percent ring
//   directly from this. Owner or admin only; pre-existing userId=NULL keys
//   stay admin-only.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const isOwner = role === "user" && userId && key.userId === userId;
    if (role !== "admin" && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const counters = await getApiKeyCounters(id);
    return NextResponse.json({
      keyId: id,
      counters,
      quota: {
        metric: key.quotaMetric,
        limit: key.quotaLimit,
        window: key.quotaWindow,
      },
    });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }
}
