import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getJobHuntProfile, rescoreAllListings, updateJobHuntProfile } from "@/lib/db/job-hunt";
import { runAllJobSearches } from "@/lib/job-hunt/search-sources";
import { appendJobHuntEvent } from "@/lib/db/job-hunt";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const body = (await req.json().catch(() => ({}))) as { minScore?: number };
  const minScore = body.minScore ?? 40;
  const profile = getJobHuntProfile();

  try {
    const result = await runAllJobSearches(profile, minScore);
    updateJobHuntProfile({ lastSearchAt: new Date().toISOString() });
    appendJobHuntEvent({
      kind: "search_run",
      message: `${result.imported} offres importées`,
      payload: result,
    });
    return withSecurity(NextResponse.json({ ok: true, ...result }));
  } catch (err) {
    return withSecurity(
      NextResponse.json({ error: err instanceof Error ? err.message : "Recherche échouée" }, { status: 502 }),
    );
  }
}
