import { handleOfficeCommandRoute } from "@/lib/office/command-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  return handleOfficeCommandRoute(req, context, "pause");
}
