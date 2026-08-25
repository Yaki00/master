import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { pixelbrainSupportFetch } from "@/lib/pixelbrain-support-api";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await req.json();
  const result = await pixelbrainSupportFetch<unknown>(
    `/support/admin/conversations/${id}/messages`,
    { method: "POST", body: JSON.stringify(body) },
  );

  if (!result.ok) {
    return withSecurity(
      NextResponse.json({ error: result.error }, { status: result.status }),
    );
  }
  return withSecurity(NextResponse.json(result.data));
}
