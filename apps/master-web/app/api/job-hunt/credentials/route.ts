import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  deletePlatformCredential,
  listPlatformCredentials,
  savePlatformCredential,
} from "@/lib/job-hunt/credentials";
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
  return withSecurity(NextResponse.json({ credentials: listPlatformCredentials() }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const platform = String(body.platform ?? "").trim();
  if (!platform) {
    return withSecurity(NextResponse.json({ error: "platform requis" }, { status: 400 }));
  }

  const saved = savePlatformCredential(platform, {
    loginUrl: body.loginUrl != null ? String(body.loginUrl) : undefined,
    email: body.email != null ? String(body.email) : undefined,
    password: body.password != null ? String(body.password) : undefined,
    useGoogleSso: body.useGoogleSso != null ? Boolean(body.useGoogleSso) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
  });

  if (!saved) {
    return withSecurity(NextResponse.json({ error: "plateforme inconnue" }, { status: 404 }));
  }

  return withSecurity(NextResponse.json({ ok: true, credential: saved }));
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const platform =
    new URL(req.url).searchParams.get("platform")?.trim() ||
    String(((await req.json().catch(() => ({}))) as { platform?: string }).platform ?? "").trim();

  if (!platform) {
    return withSecurity(NextResponse.json({ error: "platform requis" }, { status: 400 }));
  }

  return withSecurity(NextResponse.json({ ok: deletePlatformCredential(platform) }));
}
