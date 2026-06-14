import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import MyApiKeyPageClient from "./MyApiKeyPageClient";

const S = SECTIONS["my-api-key"];

// Resolve role server-side. Mirrors dashboardGuard's getSessionRole(): a legacy
// { authenticated:true } session reads as admin. Unauthenticated sessions are
// already 302'd by the guard, so we only need the user/admin discrimination.
async function resolveRole() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (!session) return null;
  if (session.role === "admin" || session.role === "user") return session.role;
  if (session.authenticated) return "admin";
  return null;
}

export default async function MyApiKeyPage() {
  const role = await resolveRole();
  // Admins keep the full /dashboard/endpoint surface; bounce them there if
  // they hit this URL directly. Users land here.
  if (role === "admin") redirect("/dashboard/endpoint");

  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />
      <MyApiKeyPageClient />
    </div>
  );
}
