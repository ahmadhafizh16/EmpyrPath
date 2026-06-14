import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listPlans, createPlan } from "@/lib/db/repos/subscriptionPlansRepo.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

// Resolve { role, userId } from the auth cookie. Mirrors dashboardGuard's
// getSessionRole() — legacy { authenticated:true } sessions read as admin.
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

// GET /api/subscription-plans
//   admin → full catalog (incl. inactive)
//   user  → active plans only (the purchasable catalog)
export async function GET() {
  try {
    const { role } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const plans = await listPlans({ activeOnly: role !== "admin" });
    return NextResponse.json({ plans });
  } catch (error) {
    console.log("Error fetching subscription plans:", error);
    return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}

// POST /api/subscription-plans — admin only. Create a catalog plan.
export async function POST(request) {
  try {
    const { role } = await getSessionContext();
    if (role !== "admin") {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }
    const body = await request.json();
    const plan = await createPlan(body);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    // normalizePlanInput throws Error(message) for validation failures.
    const msg = error?.message || "Failed to create plan";
    const status = /required|must be|array/.test(msg) ? 400 : 500;
    if (status === 500) console.log("Error creating plan:", error);
    return NextResponse.json({ error: msg }, { status });
  }
}
