import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getJobHuntProfile, rescoreAllListings, updateJobHuntProfile } from "@/lib/db/job-hunt";
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
  return withSecurity(NextResponse.json({ profile: getJobHuntProfile() }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profile = updateJobHuntProfile({
    fullName: body.fullName != null ? String(body.fullName) : undefined,
    email: body.email != null ? String(body.email) : undefined,
    phone: body.phone != null ? String(body.phone) : undefined,
    location: body.location != null ? String(body.location) : undefined,
    timezone: body.timezone != null ? String(body.timezone) : undefined,
    cvBase: body.cvBase != null ? String(body.cvBase) : undefined,
    cvFileName: body.cvFileName != null ? String(body.cvFileName) : undefined,
    cvAnalyzedAt: body.cvAnalyzedAt !== undefined ? (body.cvAnalyzedAt as string | null) : undefined,
    stack: Array.isArray(body.stack) ? body.stack.map(String) : undefined,
    targetRoles: Array.isArray(body.targetRoles) ? body.targetRoles.map(String) : undefined,
    languages: Array.isArray(body.languages) ? body.languages.map(String) : undefined,
    minSalaryEur: body.minSalaryEur !== undefined ? (body.minSalaryEur == null ? null : Number(body.minSalaryEur)) : undefined,
    remoteOnly: body.remoteOnly != null ? Boolean(body.remoteOnly) : undefined,
    preferredRegions: Array.isArray(body.preferredRegions) ? body.preferredRegions.map(String) : undefined,
    coverLetterTemplate: body.coverLetterTemplate != null ? String(body.coverLetterTemplate) : undefined,
    platforms: Array.isArray(body.platforms) ? body.platforms.map(String) : undefined,
    autoSearchEnabled: body.autoSearchEnabled != null ? Boolean(body.autoSearchEnabled) : undefined,
    autoApplyEnabled: body.autoApplyEnabled != null ? Boolean(body.autoApplyEnabled) : undefined,
    minScoreAutoApply: body.minScoreAutoApply != null ? Number(body.minScoreAutoApply) : undefined,
    maxApplicationsPerDay: body.maxApplicationsPerDay != null ? Number(body.maxApplicationsPerDay) : undefined,
    searchIntervalHours: body.searchIntervalHours != null ? Number(body.searchIntervalHours) : undefined,
  });

  const rescored = body.rescoreListings ? rescoreAllListings() : 0;
  return withSecurity(NextResponse.json({ ok: true, profile, rescored }));
}
