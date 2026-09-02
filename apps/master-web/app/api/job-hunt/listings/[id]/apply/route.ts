import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getJobHuntListing, updateJobHuntListing } from "@/lib/db/job-hunt";
import { enqueueJobHuntAction } from "@/lib/job-hunt/engine";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await ctx.params;
  const listing = getJobHuntListing(id);
  if (!listing) return withSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "tailor" ? "tailor" : "apply";

  const result = enqueueJobHuntAction(id, action);
  if (!result.ok) {
    return withSecurity(NextResponse.json({ error: result.error }, { status: result.error?.includes("hors ligne") ? 503 : 400 }));
  }

  if (action === "tailor") {
    updateJobHuntListing(id, { status: "queued" });
  }

  return withSecurity(
    NextResponse.json({
      ok: true,
      jobId: result.jobId,
      message: action === "apply" ? "Agent PC lancé — remplissage navigateur" : "Adaptation CV lancée",
    }),
  );
}
