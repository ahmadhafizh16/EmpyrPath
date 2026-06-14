import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPlanById, updatePlan, deletePlan } from "@/lib/db/repos/subscriptionPlansRepo.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (!session) return false;
  if (session.role === "admin") return true;
  if (session.authenticated && !session.role) return true; // legacy session
  return false;
}

// GET /api/subscription-plans/[id] — admin only (catalog detail).
export async function GET(_request, { params }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }
    const { id } = await params;
    const plan = await getPlanById(id);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (error) {
    console.log("Error fetching plan:", error);
    return NextResponse.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

// PATCH /api/subscription-plans/[id] — admin only. Partial update.
// Edits do not retroactively touch live subscriptions (those carry snapshots).
export async function PATCH(request, { params }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }
    const { id } = await params;
    const existing = await getPlanById(id);
    if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const body = await request.json();
    const plan = await updatePlan(id, body);
    return NextResponse.json({ plan });
  } catch (error) {
    const msg = error?.message || "Failed to update plan";
    const status = /required|must be|array/.test(msg) ? 400 : 500;
    if (status === 500) console.log("Error updating plan:", error);
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/subscription-plans/[id] — admin only. Existing subscriptions
// keep working (they hold snapshots and a nullable planId).
export async function DELETE(_request, { params }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }
    const { id } = await params;
    const ok = await deletePlan(id);
    if (!ok) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error deleting plan:", error);
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
