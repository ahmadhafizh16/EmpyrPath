import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiKeyById } from "@/lib/localDb";
import { setApiKeyAllowedModels } from "@/lib/db/index.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

async function getSessionContext() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (!session) return { role: null };
  if (session.role === "admin" || session.role === "user") return { role: session.role };
  if (session.authenticated) return { role: "admin" };
  return { role: null };
}

// PATCH /api/keys/[id]/allowed-models — admin only.
//   Body: { models: string[] } to set the allowlist (empty array blocks all
//   models for this key); { clear: true } to remove the restriction
//   (unrestricted = the key may call any model).
//
//   Foundation for future subscription tiers — a tier preset would just call
//   this endpoint with a fixed list per plan.
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
      const updated = await setApiKeyAllowedModels(id, null);
      return NextResponse.json({ key: updated });
    }

    if (!Array.isArray(body.models)) {
      return NextResponse.json(
        { error: "Body must include { models: string[] } or { clear: true }" },
        { status: 400 },
      );
    }

    const updated = await setApiKeyAllowedModels(id, body.models);
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating allowed models:", error);
    return NextResponse.json({ error: "Failed to update allowed models" }, { status: 500 });
  }
}
