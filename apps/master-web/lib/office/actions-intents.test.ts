import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import { listAiProjects } from "@/lib/db/ai-projects";
import { claimOfficeCommands, listOfficeEvents } from "@/lib/db/office";
import { listOfficeTasks } from "@/lib/db/office-tasks";
import { listAgentLogs } from "@/lib/db/agent-logs";
import { dispatchOfficeAction } from "@/lib/office/actions";

describe("actions — veille et mail", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-act-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("crée sentinelle depuis chat veille produit", async () => {
    const r = await dispatchOfficeAction("openclaw:office", "message", {
      text: "surveille RTX 4090 toutes les 15 min sur eBay",
    });
    expect(r.ok).toBe(true);
    const projects = listAiProjects();
    expect(projects.some((p) => p.kind === "recurring" && p.meta.watchType === "sentinel")).toBe(true);
    expect(projects[0]?.nextRunAt).toBeTruthy();
  });

  it("lance wizard mail si IMAP absent", async () => {
    delete process.env.MAIL_IMAP_HOST;
    delete process.env.MAIL_IMAP_USER;
    delete process.env.MAIL_IMAP_PASS;
    const r = await dispatchOfficeAction("openclaw:office", "message", {
      text: "analyse ma boîte mail",
    });
    expect(r.ok).toBe(true);
    expect(r.commandId).toBeUndefined();
    const events = listOfficeEvents("openclaw:office");
    expect(events.some((e) => e.kind === "agent_message" && /IMAP|branch/i.test(String(e.payload.text)))).toBe(
      true,
    );
    const cmds = claimOfficeCommands("test", 5);
    expect(cmds.some((c) => c.payload.mailBrief === true)).toBe(false);
  });

  it("lance réunion all-hands sans commande LLM réception", async () => {
    const msg =
      "organise une réunion avec tout le monde pour trouver le meilleur objet à vendre sur eBay";
    const r = await dispatchOfficeAction("openclaw:office", "message", { text: msg });
    expect(r.ok).toBe(true);
    expect(r.commandId).toBeUndefined();

    const cmds = claimOfficeCommands("test", 20);
    expect(cmds.every((c) => c.agentId !== "openclaw:office")).toBe(true);
    expect(cmds.filter((c) => c.payload.meetingRound === true).length).toBe(4);

    const tasks = listOfficeTasks({ status: "active" });
    expect(tasks.some((t) => t.meta.meeting === true && t.phase === "meeting")).toBe(true);

    const events = listOfficeEvents("openclaw:office");
    expect(events.some((e) => e.kind === "agent_message" && /Réunion lancée/.test(String(e.payload.text)))).toBe(
      true,
    );
    expect(events.some((e) => e.kind === "agent_message" && /Mgr Dev.*casques VR/i.test(String(e.payload.text)))).toBe(
      false,
    );

    const logs = listAgentLogs("openclaw:office", 10);
    expect(logs.some((l) => /Réunion lancée/.test(l.content))).toBe(true);
  });
});
