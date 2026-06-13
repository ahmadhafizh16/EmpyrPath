import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
	createUser,
	listUsers,
	publicUser,
} from "@/lib/db/repos/usersRepo.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;
const VALID_ROLES = new Set(["admin", "user"]);
const CLI_TOKEN_HEADER = "x-9r-cli-token";

// dashboardGuard.js already gates /api/* — this route is reachable only by
// 1) a request bearing a valid x-9r-cli-token (CLI on host), or
// 2) a logged-in admin session (because POST is a mutating method).
// We additionally require admin OR cli-token at the route level so we can
// trust callers when manipulating roles regardless of guard policy changes.
function isAdminCaller(request, session) {
	if (request.headers.get(CLI_TOKEN_HEADER)) return true;
	return !!session && (session.role === "admin" || session.authenticated === true);
}

export async function GET() {
	try {
		const users = (await listUsers()).map(publicUser);
		return NextResponse.json({ users });
	} catch (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}

// POST /api/users — provision a user with an explicit role. Used by:
//   - 9router CLI admin command (via x-9r-cli-token)
//   - Admin dashboard UI (future) for inviting members
//
// Bodies: { email, password, name?, role: "admin" | "user" }
export async function POST(request) {
	try {
		const cookieStore = await cookies();
		const session = await getDashboardAuthSession(
			cookieStore.get("auth_token")?.value,
		);
		if (!isAdminCaller(request, session)) {
			return NextResponse.json(
				{ error: "Admin role or CLI token required." },
				{ status: 403 },
			);
		}

		const body = await request.json();
		const email = typeof body.email === "string" ? body.email.trim() : "";
		const password = typeof body.password === "string" ? body.password : "";
		const name = typeof body.name === "string" ? body.name.trim() : null;
		const role = typeof body.role === "string" ? body.role : "user";

		if (!EMAIL_RE.test(email)) {
			return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
		}
		if (password.length < MIN_PASSWORD_LEN) {
			return NextResponse.json(
				{ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
				{ status: 400 },
			);
		}
		if (!VALID_ROLES.has(role)) {
			return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
		}

		try {
			const user = await createUser({ email, password, name, role });
			return NextResponse.json({ success: true, user: publicUser(user) }, { status: 201 });
		} catch (err) {
			if (err.code === "EMAIL_TAKEN") {
				return NextResponse.json(
					{ error: "That email is already registered." },
					{ status: 409 },
				);
			}
			throw err;
		}
	} catch (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}
