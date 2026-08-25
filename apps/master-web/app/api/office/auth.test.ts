import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { closeDb } from "@/lib/db/sqlite";
import { POST as ingestPost } from "@/app/api/office/ingest/route";
import { GET as agentsGet } from "@/app/api/office/agents/route";
import { GET as commandsGet } from "@/app/api/office/commands/route";
import { POST as actPost } from "@/app/api/office/act/route";
import { POST as eventsPost } from "@/app/api/office/events/route";

const getSession = getServerSession as unknown as ReturnType<typeof vi.fn>;

function uniqueDb() {
  const dir = mkdtempSync(join(tmpdir(), "master-office-api-"));
  process.env.MASTER_DB_PATH = join(dir, "test.db");
  process.env.WORKER_TOKEN = "test-worker-token";
  closeDb();
  return dir;
}

describe("office API auth", () => {
  let dir: string;

  beforeEach(() => {
    dir = uniqueDb();
    getSession.mockReset();
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/office/agents → 401 sans session", async () => {
    getSession.mockResolvedValue(null);
    const res = await agentsGet();
    expect(res.status).toBe(401);
  });

  it("POST /api/office/ingest → 401 sans token worker", async () => {
    const res = await ingestPost(
      new Request("http://localhost/api/office/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: [] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/office/commands → 401 sans token worker", async () => {
    const res = await commandsGet(new Request("http://localhost/api/office/commands"));
    expect(res.status).toBe(401);
  });

  it("POST /api/office/act → 401 sans session", async () => {
    getSession.mockResolvedValue(null);
    const res = await actPost(
      new Request("http://localhost/api/office/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "openclaw:main", kind: "message", text: "ping" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/office/events → 401 sans token worker", async () => {
    const res = await eventsPost(
      new Request("http://localhost/api/office/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "openclaw:main", kind: "agent_message", text: "interim" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
