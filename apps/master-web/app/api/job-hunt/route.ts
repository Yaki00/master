import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getJobHuntAutomationStatus,
  getJobHuntProfile,
  getJobHuntStats,
  listJobHuntListings,
} from "@/lib/db/job-hunt";
import { listSearchHistory } from "@/lib/db/job-hunt-search-history";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  return withSecurity(
    NextResponse.json({
      profile: getJobHuntProfile(),
      stats: getJobHuntStats(),
      automation: getJobHuntAutomationStatus(),
      listings: listJobHuntListings({ limit: 200 }),
      searchHistory: listSearchHistory(),
    }),
  );
}
