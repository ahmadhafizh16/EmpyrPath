import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
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

// 403 unless: admin, OR session userId matches the key's owner.
// Pre-existing keys with userId=NULL are admin-pool — never accessible to users.
function isAuthorized(role, userId, key) {
  if (role === "admin") return true;
  if (role === "user" && userId && key.userId === userId) return true;
  return false;
}

// GET /api/keys/[id] — owner or admin
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!isAuthorized(role, userId, key)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] — owner or admin (toggle isActive)
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!isAuthorized(role, userId, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { isActive } = body;
    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateApiKey(id, updateData);
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] — owner or admin
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { role, userId } = await getSessionContext();
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!isAuthorized(role, userId, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = await deleteApiKey(id);
    if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
