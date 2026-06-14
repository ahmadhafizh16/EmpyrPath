import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getApiKeys,
  getApiKeysByUserId,
  createApiKey,
} from "@/lib/db/repos/apiKeysRepo.js";
import { getSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
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

// GET /api/keys
//   admin → every row (incl. userId=NULL admin-pool)
//   user  → only rows where userId === session.userId
export async function GET() {
  try {
    const { role, userId } = await getSessionContext();
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const keys = role === "admin"
      ? await getApiKeys()
      : await getApiKeysByUserId(userId);
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys
//   admin → always; may pass an explicit userId to mint on behalf of a user
//   user  → only when settings.allowUserKeyGeneration === true; server attaches
//           session.userId, ignores any client-supplied userId
export async function POST(request) {
  try {
    const { role, userId: sessionUserId } = await getSessionContext();
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let ownerUserId;
    if (role === "admin") {
      ownerUserId = typeof body.userId === "string" && body.userId ? body.userId : null;
    } else {
      const settings = await getSettings();
      if (settings.allowUserKeyGeneration !== true) {
        return NextResponse.json(
          { error: "Self-service key generation is disabled. Contact an admin." },
          { status: 403 },
        );
      }
      ownerUserId = sessionUserId;
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey({ name, machineId, userId: ownerUserId });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      userId: apiKey.userId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
