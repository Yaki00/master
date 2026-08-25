import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import {
  createAiProject,
  deleteAiProject,
  listAiProjects,
  listDueRecurringProjects,
  updateAiProject,
} from "@/lib/db/ai-projects";
import { appendAgentLog, listAgentLogs } from "@/lib/db/agent-logs";

describe("ai_projects + agent_logs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "master-proj-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });
  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("CRUD projet", () => {
    const p = createAiProject({
      title: "Scan GPU",
      kind: "recurring",
      schedule: "lundi 9h",
      notes: "ebay",
    });
    expect(listAiProjects()).toHaveLength(1);
    expect(updateAiProject(p.id, { status: "paused" })?.status).toBe("paused");
    expect(deleteAiProject(p.id)).toBe(true);
    expect(listAiProjects()).toHaveLength(0);
  });

  it("listDueRecurringProjects filtre next_run_at passé", () => {
    const past = "2020-01-01T00:00:00.000Z";
    const future = "2099-01-01T00:00:00.000Z";
    createAiProject({
      title: "Sentinelle GPU due",
      kind: "recurring",
      status: "active",
      nextRunAt: past,
      brief: "Surveille RTX 4090",
    });
    createAiProject({
      title: "Sentinelle GPU future",
      kind: "recurring",
      status: "active",
      nextRunAt: future,
    });
    createAiProject({
      title: "Ponctuel",
      kind: "punctual",
      status: "active",
      nextRunAt: past,
    });
    createAiProject({
      title: "Paused due",
      kind: "recurring",
      status: "paused",
      nextRunAt: past,
    });
    const due = listDueRecurringProjects("2026-08-24T12:00:00.000Z");
    expect(due).toHaveLength(1);
    expect(due[0]?.title).toBe("Sentinelle GPU due");
  });

  it("logs réflexion", () => {
    appendAgentLog("openclaw:chef", "reflection", "Je délègue au mgr-dev");
    appendAgentLog("openclaw:chef", "outcome", "OK spawn");
    const logs = listAgentLogs("openclaw:chef", 10);
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.kind).sort()).toEqual(["outcome", "reflection"]);
  });
});
