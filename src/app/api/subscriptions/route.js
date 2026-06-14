import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSubscriptionsByUser,
  getPendingSubscriptions,
  requestSubscription,
} from "@/lib/db/repos/userSubscriptionsRepo.js";
import { getPlanById } from "@/lib/db/repos/subscriptionPlansRepo.js";
import { getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
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

// GET /api/subscriptions
//   admin → ?status=pending returns the approval queue; otherwise returns all
//           (queue is the common admin view, so default it).
//   user  → all of their own subscriptions (any status).
export async function GET(request) {
  try {
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (role === "admin") {
      const { searchParams } = new URL(request.url);
      const status = searchParams.get("status");
      if (status === "pending" || !status) {
        const subscriptions = await getPendingSubscriptions();
        return NextResponse.json({ subscriptions });
      }
      // Other statuses not commonly needed on the admin queue; respond empty.
      return NextResponse.json({ subscriptions: [] });
    }

    const subscriptions = await getSubscriptionsByUser(userId);
    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.log("Error fetching subscriptions:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}

// POST /api/subscriptions — user requests a plan against one of their keys.
// Body: { planId, keyId }. Status starts as 'pending' (admin approves).
// Admins may also call this to provision a grant; if so they pass userId too.
export async function POST(request) {
  try {
    const { role, userId: sessionUserId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const planId = body.planId;
    const keyId = body.keyId;
    if (!planId || !keyId) {
      return NextResponse.json({ error: "planId and keyId are required" }, { status: 400 });
    }

    const plan = await getPlanById(planId);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (!plan.isActive && role !== "admin") {
      return NextResponse.json({ error: "Plan is not available" }, { status: 403 });
    }

    const key = await getApiKeyById(keyId);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    // Ownership: a user may only attach a subscription to their own key. Admins
    // may attach on behalf of a user (body.userId) or against any key — when an
    // admin acts on behalf of a user, the userId comes from the body.
    let ownerUserId;
    if (role === "admin") {
      ownerUserId = body.userId || key.userId;
      if (!ownerUserId) {
        return NextResponse.json(
          { error: "Cannot attach a subscription to an unowned admin-pool key" },
          { status: 400 }
        );
      }
    } else {
      if (key.userId !== sessionUserId) {
        return NextResponse.json({ error: "Key does not belong to you" }, { status: 403 });
      }
      ownerUserId = sessionUserId;
    }

    const subscription = await requestSubscription({ userId: ownerUserId, keyId, plan });
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    console.log("Error requesting subscription:", error);
    return NextResponse.json({ error: "Failed to request subscription" }, { status: 500 });
  }
}
