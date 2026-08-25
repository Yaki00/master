import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  createAiProject,
  deleteAiProject,
  listAiProjects,
  updateAiProject,
  type AiProjectKind,
  type AiProjectStatus,
} from "@/lib/db/ai-projects";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") as AiProjectStatus | "all" | null;
  return withOfficeSecurity(NextResponse.json({ projects: listAiProjects(status ?? "all") }));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) {
    return withOfficeSecurity(NextResponse.json({ error: "title requis" }, { status: 400 }));
  }
  const project = createAiProject({
    title,
    kind: body.kind === "recurring" ? "recurring" : "punctual",
    schedule: body.schedule != null ? String(body.schedule) : null,
    status: (body.status as AiProjectStatus) || "active",
    notes: body.notes != null ? String(body.notes) : "",
    agentId: body.agentId != null ? String(body.agentId) : null,
    brief: body.brief != null ? String(body.brief) : "",
    goals: body.goals != null ? String(body.goals) : "",
    priority: body.priority != null ? Number(body.priority) : 0,
    nextRunAt: body.nextRunAt != null ? String(body.nextRunAt) : null,
    teamId: body.teamId != null ? String(body.teamId) : null,
  });
  return withOfficeSecurity(NextResponse.json({ ok: true, project }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
  const project = updateAiProject(id, {
    title: body.title != null ? String(body.title) : undefined,
    kind: body.kind as AiProjectKind | undefined,
    schedule: body.schedule !== undefined ? (body.schedule as string | null) : undefined,
    status: body.status as AiProjectStatus | undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
    agentId: body.agentId !== undefined ? (body.agentId as string | null) : undefined,
    brief: body.brief != null ? String(body.brief) : undefined,
    goals: body.goals != null ? String(body.goals) : undefined,
    priority: body.priority != null ? Number(body.priority) : undefined,
    nextRunAt: body.nextRunAt !== undefined ? (body.nextRunAt as string | null) : undefined,
    teamId: body.teamId !== undefined ? (body.teamId as string | null) : undefined,
  });
  if (!project) return withOfficeSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));
  return withOfficeSecurity(NextResponse.json({ ok: true, project }));
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
    const ok = deleteAiProject(String(body.id));
    return withOfficeSecurity(NextResponse.json({ ok }));
  }
  return withOfficeSecurity(NextResponse.json({ ok: deleteAiProject(id) }));
}
