import { handleOfficeAct } from "@/lib/office/command-route";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleOfficeAct(req);
}
