import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getJobHuntListing, listJobHuntEvents } from "@/lib/db/job-hunt";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await ctx.params;
  const listing = getJobHuntListing(id);
  if (!listing) return withSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));

  return withSecurity(
    NextResponse.json({
      listing,
      events: listJobHuntEvents(id),
    }),
  );
}
