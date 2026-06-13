import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
	getUserById,
	setUserRole,
	setUserActive,
	deleteUser,
	updateUserPassword,
	publicUser,
} from "@/lib/db/repos/usersRepo.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

const VALID_ROLES = new Set(["admin", "user"]);
const MIN_PASSWORD_LEN = 6;
const CLI_TOKEN_HEADER = "x-9r-cli-token";

// Mirrors /api/users/route.js: admin session OR CLI token. dashboardGuard
// already gates this path (mutating methods → admin), but route-level checks
// keep behaviour consistent if the guard policy changes.
function isAdminCaller(request, session) {
	if (request.headers.get(CLI_TOKEN_HEADER)) return true;
	return !!session && (session.role === "admin" || session.authenticated === true);
}

async function requireAdmin(request) {
	const cookieStore = await cookies();
	const session = await getDashboardAuthSession(
		cookieStore.get("auth_token")?.value,
	);
	if (!isAdminCaller(request, session)) {
		return {
			ok: false,
			response: NextResponse.json(
				{ error: "Admin role or CLI token required." },
				{ status: 403 },
			),
		};
	}
	return { ok: true, session };
}

async function loadOr404(id) {
	const user = await getUserById(id);
	if (!user) {
		return {
			ok: false,
			response: NextResponse.json({ error: "User not found." }, { status: 404 }),
		};
	}
	return { ok: true, user };
}

export async function GET(request, { params }) {
	const auth = await requireAdmin(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const found = await loadOr404(id);
	if (!found.ok) return found.response;
	return NextResponse.json({ user: publicUser(found.user) });
}

// PATCH /api/users/:id  — partial update. Accepts:
//   { role: "admin" | "user" }
//   { isActive: boolean }
//   { password: string }   ← admin-driven password reset
// Body keys are applied in order; unknown keys are ignored.
export async function PATCH(request, { params }) {
	const auth = await requireAdmin(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const found = await loadOr404(id);
	if (!found.ok) return found.response;

	let body;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
	}

	// Self-protection: an admin acting on their own account cannot demote
	// themselves or deactivate themselves — would lock them out instantly.
	const callerIsTarget = auth.session?.userId === id;

	if (Object.prototype.hasOwnProperty.call(body, "role")) {
		const role = body.role;
		if (!VALID_ROLES.has(role)) {
			return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
		}
		if (callerIsTarget && role !== "admin") {
			return NextResponse.json(
				{ error: "You cannot demote your own admin account." },
				{ status: 400 },
			);
		}
		await setUserRole(id, role);
	}

	if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
		const isActive = body.isActive === true;
		if (callerIsTarget && !isActive) {
			return NextResponse.json(
				{ error: "You cannot deactivate your own account." },
				{ status: 400 },
			);
		}
		await setUserActive(id, isActive);
	}

	if (Object.prototype.hasOwnProperty.call(body, "password")) {
		const password = String(body.password || "");
		if (password.length < MIN_PASSWORD_LEN) {
			return NextResponse.json(
				{ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
				{ status: 400 },
			);
		}
		await updateUserPassword(id, password);
	}

	const fresh = await getUserById(id);
	return NextResponse.json({ user: publicUser(fresh) });
}

export async function DELETE(request, { params }) {
	const auth = await requireAdmin(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	if (auth.session?.userId === id) {
		return NextResponse.json(
			{ error: "You cannot delete your own account." },
			{ status: 400 },
		);
	}
	const ok = await deleteUser(id);
	if (!ok) {
		return NextResponse.json({ error: "User not found." }, { status: 404 });
	}
	return NextResponse.json({ success: true });
}
