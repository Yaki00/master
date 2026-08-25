import { listOfficeFeed } from "@/lib/db/office";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Session → fil global multi-agents (CDC-02). */
export async function GET(req: Request) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 80);
  const events = listOfficeFeed(limit);
  return withOfficeSecurity(NextResponse.json({ events }));
}
