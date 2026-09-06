import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProjectFile, upsertProjectFile } from "@/lib/db/project-files";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: rawProject, fileId: rawFile } = await context.params;
  const projectId = decodeURIComponent(rawProject);
  const fileId = decodeURIComponent(rawFile);
  const file = getProjectFile(fileId);
  if (!file || file.projectId !== projectId) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }
  return withOfficeSecurity(NextResponse.json({ file }));
}

export async function PUT(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: rawProject, fileId: rawFile } = await context.params;
  const projectId = decodeURIComponent(rawProject);
  const fileId = decodeURIComponent(rawFile);
  const existing = getProjectFile(fileId);
  if (!existing || existing.projectId !== projectId) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const content = body.content != null ? String(body.content) : existing.content;
  const file = upsertProjectFile({
    projectId,
    path: existing.path,
    content,
    mime: body.mime != null ? String(body.mime) : existing.mime,
  });
  return withOfficeSecurity(NextResponse.json({ ok: true, file }));
}
