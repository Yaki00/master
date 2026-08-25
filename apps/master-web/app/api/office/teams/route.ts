import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  createAgentTeam,
  deleteAgentTeam,
  listAgentTeams,
  updateAgentTeam,
  type TeamMemberRole,
} from "@/lib/db/agent-teams";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return withOfficeSecurity(NextResponse.json({ teams: listAgentTeams() }));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) {
    return withOfficeSecurity(NextResponse.json({ error: "name requis" }, { status: 400 }));
  }
  const membersRaw = Array.isArray(body.members) ? body.members : [];
  const team = createAgentTeam({
    name,
    leadAgentId: body.leadAgentId != null ? String(body.leadAgentId) : null,
    notes: body.notes != null ? String(body.notes) : "",
    members: membersRaw.map((m, i) => {
      const row = m as Record<string, unknown>;
      return {
        agentId: String(row.agentId ?? ""),
        roleInTeam: row.roleInTeam as TeamMemberRole | undefined,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : i,
      };
    }).filter((m) => m.agentId),
  });
  return withOfficeSecurity(NextResponse.json({ ok: true, team }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
  const membersRaw = body.members !== undefined && Array.isArray(body.members) ? body.members : undefined;
  const team = updateAgentTeam(id, {
    name: body.name != null ? String(body.name) : undefined,
    leadAgentId: body.leadAgentId !== undefined ? (body.leadAgentId as string | null) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
    members: membersRaw?.map((m, i) => {
      const row = m as Record<string, unknown>;
      return {
        agentId: String(row.agentId ?? ""),
        roleInTeam: row.roleInTeam as TeamMemberRole | undefined,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : i,
      };
    }).filter((m) => m.agentId),
  });
  if (!team) return withOfficeSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));
  return withOfficeSecurity(NextResponse.json({ ok: true, team }));
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
    return withOfficeSecurity(NextResponse.json({ ok: deleteAgentTeam(String(body.id)) }));
  }
  return withOfficeSecurity(NextResponse.json({ ok: deleteAgentTeam(id) }));
}
