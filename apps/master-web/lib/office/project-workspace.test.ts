import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import { listProjectFiles } from "@/lib/db/project-files";
import { getOrchestration } from "@/lib/office/project-orchestrator";
import { getAiProject } from "@/lib/db/ai-projects";
import { parseOutreachListIntent } from "@/lib/office/outreach-intent";
import { scaffoldOutreachProject } from "@/lib/office/project-workspace";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { upsertOfficeAgent } from "@/lib/db/office";

describe("project workspace outreach", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-ws-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
    getDb();
    upsertOfficeAgent({
      id: "openclaw:office",
      kind: "openclaw",
      name: "Réception",
      status: "idle",
      task: null,
      currentAction: null,
      lastSeenAt: new Date().toISOString(),
      meta: {},
    });
  });
  afterEach(() => closeDb());

  it("scaffold crée CSV + mail + plan PM", () => {
    const intent = parseOutreachListIntent(
      "Liste les boulangeries sans site autour de Trappes",
    )!;
    const r = scaffoldOutreachProject(intent, "openclaw:office");
    const files = listProjectFiles(r.projectId).map((f) => f.path);
    expect(files).toEqual(expect.arrayContaining(["README.md", "prospects.csv", "mail-draft.txt"]));
    expect(getOrchestration(getAiProject(r.projectId)!)?.phase).toBe("awaiting_plan_approval");
  });

  it("dispatch outreach via message", async () => {
    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "Trouve les restaurants sans site internet autour de Saint-Quentin-en-Yvelines",
    });
    expect(res.ok).toBe(true);
    expect(res.projectId).toBeTruthy();
    const files = listProjectFiles(res.projectId!).map((f) => f.path);
    expect(files).toContain("prospects.csv");
    expect(files).toContain("mail-draft.txt");
  });
});
