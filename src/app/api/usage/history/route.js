import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { resolveUsageApiKeyFilterOrEmpty } from "@/lib/auth/usageScope";

export async function GET() {
  try {
    const filter = await resolveUsageApiKeyFilterOrEmpty();
    const stats = await getUsageStats("all", filter || {});
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
