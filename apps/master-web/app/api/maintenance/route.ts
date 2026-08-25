import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { runDockerPrune } from "@/lib/maintenance/docker-prune";
import { getClientIp, SECURITY_HEADERS } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return withSecurity(
    NextResponse.json({
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      pixelbrainPlatformConfigured: Boolean(
        process.env.PIXELBRAIN_PLATFORM_EMAIL && process.env.PIXELBRAIN_PLATFORM_PASSWORD,
      ),
      messaging: { channel: "telegram+office", whatsapp: false },
    }),
  );
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = await getClientIp();
  const limit = checkRateLimit(`maintenance:${ip}`, { maxAttempts: 10, windowMs: 60_000 });
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? "";

  if (action === "prune") {
    const result = await runDockerPrune(true);
    return withSecurity(NextResponse.json(result));
  }

  return NextResponse.json({ error: "action inconnue (prune)" }, { status: 400 });
}
