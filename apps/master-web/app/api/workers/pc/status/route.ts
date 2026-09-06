import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getPcActivitySnapshot, stopPcActivity } from "@/lib/pc-activity";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  return withSecurity(NextResponse.json(getPcActivitySnapshot()));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  if (body.action !== "stop") {
    return withSecurity(NextResponse.json({ error: "action inconnue (stop)" }, { status: 400 }));
  }

  const result = stopPcActivity(body.reason?.trim() || "stop depuis Master /pc");
  return withSecurity(
    NextResponse.json({
      ok: true,
      ...result,
      snapshot: getPcActivitySnapshot(),
    }),
  );
}
