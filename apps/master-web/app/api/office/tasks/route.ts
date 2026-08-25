import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import {
  createOfficeTask,
  deleteOfficeTask,
  getOfficeTask,
  listOfficeTasks,
  listTaskEvents,
  updateOfficeTask,
  type OfficeTaskPhase,
  type OfficeTaskStatus,
} from "@/lib/db/office-tasks";
import { createMissionTask } from "@/lib/office/handoff";
import { enqueueOfficeCommand, appendOfficeEvent } from "@/lib/db/office";
import { getDb } from "@/lib/db/sqlite";
import { getAgentProfile } from "@/lib/db/agent-profiles";
import { getAiProject } from "@/lib/db/ai-projects";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  return Boolean(assertWorkerAuth(req));
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session && !authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (id) {
    const task = getOfficeTask(id);
    if (!task) return withOfficeSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));
    return withOfficeSecurity(
      NextResponse.json({ task, events: listTaskEvents(id) }),
    );
  }
  const status = url.searchParams.get("status") as OfficeTaskStatus | "active" | "all" | null;
  const phase = url.searchParams.get("phase") as OfficeTaskPhase | null;
  const projectId = url.searchParams.get("projectId")?.trim() || undefined;
  const tasks = listOfficeTasks({
    status: status === "all" || !status ? undefined : status,
    phase: phase ?? undefined,
    projectId,
  });
  return withOfficeSecurity(NextResponse.json({ tasks }));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const brief = String(body.brief ?? body.text ?? "").trim();
  if (!title && !brief) {
    return withOfficeSecurity(NextResponse.json({ error: "title ou brief requis" }, { status: 400 }));
  }

  const launch = body.launch === true;
  const assignee =
    String(body.assigneeAgentId ?? body.agentId ?? "openclaw:office").trim() ||
    "openclaw:office";
  const projectId = body.projectId != null ? String(body.projectId) : null;
  const project = projectId ? getAiProject(projectId) : null;
  const teamId =
    body.teamId != null ? String(body.teamId) : (project?.teamId ?? null);

  if (launch) {
    const text = brief || title;
    const persona = getAgentProfile(assignee)?.persona;
    const cmd = enqueueOfficeCommand(assignee, "message", {
      text,
      projectId,
      teamId,
      createTask: true,
      ...(persona ? { personaHint: persona.slice(0, 400) } : {}),
    });
    const task = createMissionTask({
      title: title || text.slice(0, 80),
      brief: text,
      assigneeAgentId: assignee,
      commandId: cmd.id,
      projectId,
      teamId,
      multiAgent: Boolean(teamId),
    });
    getDb()
      .prepare(`UPDATE office_commands SET payload = ?, updated_at = ? WHERE id = ?`)
      .run(
        JSON.stringify({ ...cmd.payload, taskId: task.id, text, projectId, teamId }),
        new Date().toISOString(),
        cmd.id,
      );
    appendOfficeEvent(assignee, "user_message", {
      text,
      role: "user",
      taskId: task.id,
      commandId: cmd.id,
      projectId,
    });
    return withOfficeSecurity(NextResponse.json({ ok: true, task, commandId: cmd.id }));
  }

  const task = createOfficeTask({
    title: title || brief.slice(0, 80),
    brief,
    projectId,
    teamId,
    status: (body.status as OfficeTaskStatus) || "queued",
    phase: (body.phase as OfficeTaskPhase) || "meeting",
    assigneeAgentId: assignee,
    reporterAgentId: "user",
    deliverTo: body.deliverTo != null ? String(body.deliverTo) : "user",
  });
  return withOfficeSecurity(NextResponse.json({ ok: true, task }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const worker = authed(req);
  if (!session && !worker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
  const task = updateOfficeTask(
    id,
    {
      title: body.title != null ? String(body.title) : undefined,
      brief: body.brief != null ? String(body.brief) : undefined,
      status: body.status as OfficeTaskStatus | undefined,
      phase: body.phase as OfficeTaskPhase | undefined,
      assigneeAgentId:
        body.assigneeAgentId !== undefined ? (body.assigneeAgentId as string | null) : undefined,
      deliverTo: body.deliverTo !== undefined ? (body.deliverTo as string | null) : undefined,
      resultSummary:
        body.resultSummary !== undefined ? (body.resultSummary as string | null) : undefined,
      commandId: body.commandId !== undefined ? (body.commandId as string | null) : undefined,
    },
    body.note
      ? { kind: "note", text: String(body.note), fromAgent: body.fromAgent as string | undefined }
      : undefined,
  );
  if (!task) return withOfficeSecurity(NextResponse.json({ error: "introuvable" }, { status: 404 }));
  return withOfficeSecurity(NextResponse.json({ ok: true, task }));
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return withOfficeSecurity(NextResponse.json({ error: "id requis" }, { status: 400 }));
    return withOfficeSecurity(NextResponse.json({ ok: deleteOfficeTask(String(body.id)) }));
  }
  return withOfficeSecurity(NextResponse.json({ ok: deleteOfficeTask(id) }));
}
