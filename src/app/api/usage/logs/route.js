import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { resolveUsageApiKeyFilterOrEmpty } from "@/lib/auth/usageScope";

export async function GET() {
  try {
    const filter = await resolveUsageApiKeyFilterOrEmpty();
    const logs = await getRecentLogs(200, filter || {});
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
