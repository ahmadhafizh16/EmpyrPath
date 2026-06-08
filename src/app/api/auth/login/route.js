import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import {
	verifyUserCredentials,
	countUsers,
	publicUser,
} from "@/lib/db/repos/usersRepo.js";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import {
	checkLock,
	recordFail,
	recordSuccess,
	getClientIp,
} from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT =
	"Forgot password? Reset to default via 9Router CLI → Settings → Reset Password to Default.";

function isTunnelRequest(request, settings) {
	const host = (request.headers.get("host") || "")
		.split(":")[0]
		.toLowerCase();
	const tunnelHost = settings.tunnelUrl
		? new URL(settings.tunnelUrl).hostname.toLowerCase()
		: "";
	const tailscaleHost = settings.tailscaleUrl
		? new URL(settings.tailscaleUrl).hostname.toLowerCase()
		: "";
	return (
		(tunnelHost && host === tunnelHost) ||
		(tailscaleHost && host === tailscaleHost)
	);
}

// Verify the legacy single-password admin path (settings.password / INITIAL_PASSWORD).
// Returns true if the supplied password matches; false otherwise.
async function verifyLegacyPassword(settings, password) {
	const storedHash = settings.password;
	if (storedHash) return bcrypt.compare(password, storedHash);
	const initialPassword = process.env.INITIAL_PASSWORD || "123456";
	return password === initialPassword;
}

export async function POST(request) {
	try {
		const ip = getClientIp(request);
		const lock = checkLock(ip);
		if (lock.locked) {
			return NextResponse.json(
				{
					error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`,
					retryAfter: lock.retryAfter,
					resetHint: RESET_HINT,
				},
				{
					status: 429,
					headers: { "Retry-After": String(lock.retryAfter) },
				},
			);
		}

		const { email, password } = await request.json();
		const settings = await getSettings();

		// Block login via tunnel/tailscale if dashboard access is disabled
		if (
			isTunnelRequest(request, settings) &&
			settings.tunnelDashboardAccess !== true
		) {
			return NextResponse.json(
				{ error: "Dashboard access via tunnel is disabled" },
				{ status: 403 },
			);
		}

		if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
			return NextResponse.json(
				{ error: "Password login is disabled. Use OIDC sign in." },
				{ status: 403 },
			);
		}

		// Authentication strategy:
		//   1. If email is provided AND any user exists → try users table.
		//      On match: session carries { userId, email, role }.
		//      On miss: do NOT silently fall back to legacy — that would let
		//      anyone bypass per-user auth by omitting the email.
		//   2. If email is omitted → legacy single-password admin path
		//      (settings.password / INITIAL_PASSWORD), session marked admin.
		//      This keeps existing single-tenant installs working unchanged.
		let claims = null;
		const trimmedEmail = typeof email === "string" ? email.trim() : "";
		const userCount = await countUsers();

		if (trimmedEmail && userCount > 0) {
			const user = await verifyUserCredentials(trimmedEmail, password);
			if (user) {
				claims = {
					authenticated: true,
					userId: user.id,
					email: user.email,
					role: user.role,
				};
			}
		} else if (!trimmedEmail) {
			const ok = await verifyLegacyPassword(settings, password);
			if (ok) {
				claims = { authenticated: true, role: "admin", legacy: true };
			}
		}

		if (claims) {
			recordSuccess(ip);
			const cookieStore = await cookies();
			await setDashboardAuthCookie(cookieStore, request, claims);
			return NextResponse.json({
				success: true,
				user: claims.userId
					? publicUser({
							id: claims.userId,
							email: claims.email,
							role: claims.role,
						})
					: { role: "admin", legacy: true },
			});
		}

		const { remainingBeforeLock } = recordFail(ip);
		const postLock = checkLock(ip);
		if (postLock.locked) {
			return NextResponse.json(
				{
					error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`,
					retryAfter: postLock.retryAfter,
					resetHint: RESET_HINT,
				},
				{
					status: 429,
					headers: { "Retry-After": String(postLock.retryAfter) },
				},
			);
		}
		return NextResponse.json(
			{
				error: `Invalid credentials. ${remainingBeforeLock} attempt(s) left before lockout.`,
				remainingBeforeLock,
			},
			{ status: 401 },
		);
	} catch (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}
