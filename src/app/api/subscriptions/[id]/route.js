import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSubscriptionById,
  approveSubscription,
  setSubscriptionStatus,
} from "@/lib/db/repos/userSubscriptionsRepo.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

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

// GET /api/subscriptions/[id] — admin or owning user.
export async function GET(_request, { params }) {
  try {
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const subscription = await getSubscriptionById(id);
    if (!subscription) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    if (role !== "admin" && subscription.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ subscription });
  } catch (error) {
    console.log("Error fetching subscription:", error);
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }
}

// PATCH /api/subscriptions/[id] — actions:
//   { action: "approve" } admin only — starts the clock
//   { action: "reject" }  admin only — ends a pending request
//   { action: "cancel" }  owner or admin — cancels a pending or active grant
export async function PATCH(request, { params }) {
  try {
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const subscription = await getSubscriptionById(id);
    if (!subscription) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

    const body = await request.json();
    const action = body?.action;

    if (action === "approve") {
      if (role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
      const res = await approveSubscription(id);
      if (!res.ok) {
        const status = res.error === "non_stackable_conflict" ? 409 : 400;
        return NextResponse.json({ error: res.error }, { status });
      }
      return NextResponse.json({ subscription: res.subscription });
    }

    if (action === "reject") {
      if (role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
      if (subscription.status !== "pending") {
        return NextResponse.json({ error: "Only pending subscriptions can be rejected" }, { status: 400 });
      }
      await setSubscriptionStatus(id, "rejected");
      return NextResponse.json({ subscription: { ...subscription, status: "rejected" } });
    }

    if (action === "cancel") {
      const isOwner = subscription.userId === userId;
      if (role !== "admin" && !isOwner) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!["pending", "active"].includes(subscription.status)) {
        return NextResponse.json({ error: `Cannot cancel a ${subscription.status} subscription` }, { status: 400 });
      }
      await setSubscriptionStatus(id, "cancelled");
      return NextResponse.json({ subscription: { ...subscription, status: "cancelled" } });
    }

    return NextResponse.json({ error: "action must be approve | reject | cancel" }, { status: 400 });
  } catch (error) {
    console.log("Error updating subscription:", error);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
