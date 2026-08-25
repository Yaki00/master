import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAgentProfile, listAgentProfiles, upsertAgentProfile } from "@/lib/db/agent-profiles";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = new URL(req.url).searchParams.get("agentId")?.trim();
  if (agentId) {
    return withOfficeSecurity(
      NextResponse.json({ profile: getAgentProfile(agentId) }),
    );
  }
  return withOfficeSecurity(NextResponse.json({ profiles: listAgentProfiles() }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const agentId = String(body.agentId ?? "").trim();
  if (!agentId) {
    return withOfficeSecurity(NextResponse.json({ error: "agentId requis" }, { status: 400 }));
  }
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : undefined;
  const profile = upsertAgentProfile({
    agentId,
    displayName: body.displayName !== undefined ? (body.displayName as string | null) : undefined,
    persona: body.persona != null ? String(body.persona) : undefined,
    preferredRoom:
      body.preferredRoom !== undefined ? (body.preferredRoom as string | null) : undefined,
    tags,
    active: body.active !== undefined ? Boolean(body.active) : undefined,
  });
  return withOfficeSecurity(NextResponse.json({ ok: true, profile }));
}
