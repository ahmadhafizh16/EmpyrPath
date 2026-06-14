import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { createUser, publicUser } from "@/lib/db/repos/usersRepo.js";
import { getOrCreateUserApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getClientIp, checkLock, recordFail } from "@/lib/auth/loginLimiter";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

// POST /api/auth/register
//   Public self-service signup. Always creates a 'user' role account — admin
//   accounts are provisioned out-of-band (planned 9router CLI command), never
//   via this endpoint. Does NOT sign the user in; they proceed to log in.
//
//   NOTE: role-based access is not yet enforced in dashboardGuard.js — a logged
//   in 'user' currently has the same dashboard access as an admin. Gating the
//   dashboard by role is the required follow-up before this is meaningful.
export async function POST(request) {
	try {
		const ip = getClientIp(request);
		const lock = checkLock(ip);
		if (lock.locked) {
			return NextResponse.json(
				{ error: `Too many attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
				{ status: 429, headers: { "Retry-After": String(lock.retryAfter) } },
			);
		}

		const settings = await getSettings();
		if (settings.authMode === "oidc") {
			return NextResponse.json(
				{ error: "Registration is disabled when auth mode is OIDC-only." },
				{ status: 403 },
			);
		}
		if (settings.allowSignup === false) {
			return NextResponse.json(
				{ error: "Public registration is disabled on this instance." },
				{ status: 403 },
			);
		}

		const body = await request.json();
		const email = typeof body.email === "string" ? body.email.trim() : "";
		const password = typeof body.password === "string" ? body.password : "";
		const name = typeof body.name === "string" ? body.name.trim() : null;

		if (!EMAIL_RE.test(email)) {
			return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
		}
		if (password.length < MIN_PASSWORD_LEN) {
			return NextResponse.json(
				{ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
				{ status: 400 },
			);
		}

		let user;
		try {
			// Always 'user'. createUser ignores any client-supplied role unless
			// called server-side with an explicit one (CLI admin provisioning).
			user = await createUser({ email, password, name });
		} catch (err) {
			if (err.code === "EMAIL_TAKEN") {
				return NextResponse.json(
					{ error: "That email is already registered." },
					{ status: 409 },
				);
			}
			throw err;
		}

		// Auto-issue one default API key for the new user. The key is retrievable
		// (FE-masked) on their endpoint page, so we don't return it here. A mint
		// failure must NOT roll back the account — log and continue; an admin can
		// re-issue from the Users panel.
		try {
			await getOrCreateUserApiKey(user.id, "Default");
		} catch (keyErr) {
			console.log("Failed to auto-issue API key for new user:", keyErr);
		}

		return NextResponse.json(
			{ success: true, user: publicUser(user) },
			{ status: 201 },
		);
	} catch (error) {
		// Count register failures toward the same IP lockout as login.
		try { recordFail(getClientIp(request)); } catch {}
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}
