import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  deleteJobHuntListing,
  getJobHuntListing,
  updateJobHuntListing,
} from "@/lib/db/job-hunt";
import type { JobHuntListingStatus } from "@/lib/job-hunt/types";
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
  return withSecurity(NextResponse.json({ listing }));
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const listing = updateJobHuntListing(id, {
    title: body.title != null ? String(body.title) : undefined,
    company: body.company != null ? String(body.company) : undefined,
    url: body.url != null ? String(body.url) : undefined,
    description: body.description != null ? String(body.description) : undefined,
    location: body.location != null ? String(body.location) : undefined,
    salary: body.salary != null ? String(body.salary) : undefined,
    remoteType: body.remoteType != null ? String(body.remoteType) : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    status: body.status != null ? (String(body.status) as JobHuntListingStatus) : undefined,
    tailoredCv: body.tailoredCv != null ? String(body.tailoredCv) : undefined,
    coverLetter: body.coverLetter != null ? String(body.coverLetter) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
    rescore: body.rescore != null ? Boolean(body.rescore) : undefined,
  });

  if (!listing) return withSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));
  return withSecurity(NextResponse.json({ ok: true, listing }));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await ctx.params;
  const ok = deleteJobHuntListing(id);
  return withSecurity(NextResponse.json({ ok }));
}
