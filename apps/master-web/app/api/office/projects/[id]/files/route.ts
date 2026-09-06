import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiProject } from "@/lib/db/ai-projects";
import {
  deleteProjectFile,
  getProjectFile,
  listProjectFiles,
  upsertProjectFile,
} from "@/lib/db/project-files";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: raw } = await context.params;
  const projectId = decodeURIComponent(raw);
  if (!getAiProject(projectId)) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }
  return withOfficeSecurity(NextResponse.json({ files: listProjectFiles(projectId) }));
}

export async function POST(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: raw } = await context.params;
  const projectId = decodeURIComponent(raw);
  if (!getAiProject(projectId)) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const path = String(body.path ?? "").trim();
  const content = body.content != null ? String(body.content) : "";
  if (!path) {
    return withOfficeSecurity(NextResponse.json({ error: "path requis" }, { status: 400 }));
  }
  try {
    const file = upsertProjectFile({
      projectId,
      path,
      content,
      mime: body.mime != null ? String(body.mime) : undefined,
    });
    return withOfficeSecurity(NextResponse.json({ ok: true, file }));
  } catch (err) {
    return withOfficeSecurity(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "écriture impossible" },
        { status: 400 },
      ),
    );
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: raw } = await context.params;
  const projectId = decodeURIComponent(raw);
  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId")?.trim() || "";
  if (!fileId) {
    return withOfficeSecurity(NextResponse.json({ error: "fileId requis" }, { status: 400 }));
  }
  const file = getProjectFile(fileId);
  if (!file || file.projectId !== projectId) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }
  return withOfficeSecurity(NextResponse.json({ ok: deleteProjectFile(fileId) }));
}
