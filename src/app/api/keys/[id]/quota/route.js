import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiKeyById } from "@/lib/localDb";
import { setApiKeyQuota, resetApiKeyUsage } from "@/lib/db/index.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

const VALID_METRICS = new Set(["tokens", "requests"]);
const VALID_WINDOWS = new Set(["day", "total"]);

async function getSessionContext() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (!session) return { role: null };
  if (session.role === "admin" || session.role === "user") return { role: session.role };
  if (session.authenticated) return { role: "admin" };
  return { role: null };
}

// PATCH /api/keys/[id]/quota — admin only.
//   Body: { quotaMetric, quotaLimit, quotaWindow } to set, or { clear: true }
//   to make the key unlimited. Optional { resetUsage: true } drops counters.
//   The dashboardGuard already gates mutating /api/keys to admin (or to a user
//   only when allowUserKeyGeneration is on) — quota config is admin-only, so we
//   re-check role here rather than relying on the broader keys carve-out.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { role } = await getSessionContext();
    if (role !== "admin") {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }

    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const body = await request.json();

    if (body.clear === true) {
      const updated = await setApiKeyQuota(id, {});
      if (body.resetUsage === true) await resetApiKeyUsage(id);
      return NextResponse.json({ key: updated });
    }

    const quotaMetric = body.quotaMetric;
    const quotaWindow = body.quotaWindow;
    const quotaLimit = Number(body.quotaLimit);

    if (!VALID_METRICS.has(quotaMetric)) {
      return NextResponse.json({ error: "quotaMetric must be 'tokens' or 'requests'" }, { status: 400 });
    }
    if (!VALID_WINDOWS.has(quotaWindow)) {
      return NextResponse.json({ error: "quotaWindow must be 'day' or 'total'" }, { status: 400 });
    }
    if (!Number.isFinite(quotaLimit) || quotaLimit <= 0) {
      return NextResponse.json({ error: "quotaLimit must be a positive number" }, { status: 400 });
    }

    const updated = await setApiKeyQuota(id, {
      quotaMetric,
      quotaLimit: Math.floor(quotaLimit),
      quotaWindow,
    });
    if (body.resetUsage === true) await resetApiKeyUsage(id);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating quota:", error);
    return NextResponse.json({ error: "Failed to update quota" }, { status: 500 });
  }
}
