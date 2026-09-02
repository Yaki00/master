import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createJobHuntListing, listJobHuntListings } from "@/lib/db/job-hunt";
import type { JobHuntListingStatus } from "@/lib/job-hunt/types";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const minScore = searchParams.get("minScore");
  const status = statusParam ? (statusParam.split(",") as JobHuntListingStatus[]) : undefined;

  return withSecurity(
    NextResponse.json({
      listings: listJobHuntListings({
        status,
        minScore: minScore != null ? Number(minScore) : undefined,
        limit: 200,
      }),
    }),
  );
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const url = String(body.url ?? "").trim();
  if (!title || !url) {
    return withSecurity(NextResponse.json({ error: "title et url requis" }, { status: 400 }));
  }

  const listing = createJobHuntListing({
    title,
    url,
    company: body.company != null ? String(body.company) : "",
    source: body.source != null ? String(body.source) : "manual",
    description: body.description != null ? String(body.description) : "",
    location: body.location != null ? String(body.location) : "",
    salary: body.salary != null ? String(body.salary) : "",
    remoteType: body.remoteType != null ? String(body.remoteType) : "remote",
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  });

  return withSecurity(NextResponse.json({ ok: true, listing }));
}
