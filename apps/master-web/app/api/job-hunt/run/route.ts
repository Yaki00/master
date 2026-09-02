import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { runJobHuntAutoPipeline } from "@/lib/job-hunt/engine";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const workerOk = assertWorkerAuth(req);
  if (!session && !workerOk) {
    return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const body = (await req.json().catch(() => ({}))) as { forceSearch?: boolean };
  const result = await runJobHuntAutoPipeline({ forceSearch: body.forceSearch ?? false });

  return withSecurity(NextResponse.json({ ...result }));
}
