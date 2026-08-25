import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import { createAiProject } from "@/lib/db/ai-projects";
import { claimOfficeCommands, getOfficeCommand } from "@/lib/db/office";
import { tickDueRecurringProjects } from "@/lib/office/recurring-tick";

describe("recurring tick", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-tick-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("enqueue commande sentinelle et avance nextRunAt", () => {
    const past = "2020-01-01T00:00:00.000Z";
    const project = createAiProject({
      title: "Veille RTX 4090",
      kind: "recurring",
      schedule: "toutes les 15 min",
      brief: "Surveille RTX 4090 <400€ sur eBay",
      status: "active",
      nextRunAt: past,
      meta: { watchType: "sentinel", intervalMinutes: 15 },
    });

    const result = tickDueRecurringProjects("2026-08-24T12:00:00.000Z");
    expect(result.ticked).toBe(1);
    expect(result.projectIds).toContain(project.id);

    const cmds = claimOfficeCommands("test", 5);
    expect(cmds.some((c) => c.payload.sentinelTick === true)).toBe(true);
    expect(cmds.some((c) => c.payload.forceOpenClaw === true)).toBe(true);
    const cmd = cmds.find((c) => c.payload.projectId === project.id);
    expect(cmd?.agentId).toBe("openclaw:mgr-dev");
    expect(getOfficeCommand(cmd!.id)?.payload.projectId).toBe(project.id);
  });
});
