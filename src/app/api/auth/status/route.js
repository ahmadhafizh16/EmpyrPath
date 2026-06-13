import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { countUsers } from "@/lib/db/repos/usersRepo.js";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const userCount = await countUsers();
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const sessionEmail = String(session?.email || "").trim();
    const role = session?.role || (session?.authenticated ? "admin" : null);
    const displayName =
      oidcName ||
      oidcEmail ||
      sessionEmail ||
      (session?.oidc ? "OIDC user" : session?.authenticated ? "Password user" : "");
    const loginMethod = session?.oidc
      ? "OIDC"
      : session?.userId
        ? "Email"
        : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      hasUsers: userCount > 0,
      userCount,
      bootstrap: userCount === 0,
      allowSignup: settings.allowSignup !== false,
      displayName,
      loginMethod,
      role,
      userId: session?.userId || null,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      sessionEmail: sessionEmail || null,
      oidcLogin: !!session?.oidc,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      hasPassword: false,
      hasUsers: false,
      userCount: 0,
      bootstrap: false,
      allowSignup: true,
      displayName: "Password user",
      loginMethod: "Password",
      role: null,
      userId: null,
      oidcName: null,
      oidcEmail: null,
      sessionEmail: null,
      oidcLogin: false,
    });
  }
}
