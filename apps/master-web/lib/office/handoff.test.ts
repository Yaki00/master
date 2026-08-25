import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/sqlite";
import { createAgentTeam, resolveHandoffChain } from "@/lib/db/agent-teams";
import { upsertAgentProfile, getAgentProfile } from "@/lib/db/agent-profiles";
import {
  createOfficeTask,
  getOfficeTask,
  listOfficeTasks,
  updateOfficeTask,
} from "@/lib/db/office-tasks";
import { createAiProject } from "@/lib/db/ai-projects";
import {
  createMissionTask,
  looksLikeMission,
  nextPhaseAfter,
  peekNextHandoff,
  processTaskAfterCommand,
  phaseForStatus,
} from "@/lib/office/handoff";
import { enqueueOfficeCommand, claimOfficeCommands, getOfficeCommand } from "@/lib/db/office";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("enterprise HQ — teams / tasks / handoff", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-hq-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("crée équipe et résout chaîne worker → mgr → lead → user", () => {
    const team = createAgentTeam({
      name: "Dev Squad",
      leadAgentId: "openclaw:chef",
      members: [
        { agentId: "openclaw:chef", roleInTeam: "lead", sortOrder: 0 },
        { agentId: "openclaw:mgr-dev", roleInTeam: "mgr", sortOrder: 1 },
        { agentId: "openclaw:main", roleInTeam: "worker", sortOrder: 2 },
      ],
    });
    expect(team.members).toHaveLength(3);
    expect(resolveHandoffChain(team.id, "openclaw:main")).toEqual([
      "openclaw:mgr-dev",
      "openclaw:chef",
      "user",
    ]);
    expect(resolveHandoffChain(team.id, "openclaw:mgr-dev")).toEqual([
      "openclaw:chef",
      "user",
    ]);
    expect(resolveHandoffChain(team.id, "openclaw:chef")).toEqual(["user"]);
  });

  it("upsert profil persona", () => {
    upsertAgentProfile({
      agentId: "openclaw:office",
      displayName: "Réception",
      persona: "Courtoise et concise",
      tags: ["front"],
    });
    const p = getAgentProfile("openclaw:office");
    expect(p?.persona).toMatch(/Courtoise/);
    expect(p?.displayName).toBe("Réception");
  });

  it("phases et looksLikeMission", () => {
    expect(looksLikeMission("mission délègue scan ebay")).toBe(true);
    expect(looksLikeMission("salut")).toBe(false);
    expect(nextPhaseAfter("meeting")).toBe("plan");
    expect(nextPhaseAfter("plan")).toBe("decision");
    expect(phaseForStatus("working", "decision")).toBe("execution");
    expect(phaseForStatus("done", "execution")).toBe("done");
  });

  it("projet enrichi + tâches listées par phase", () => {
    const team = createAgentTeam({
      name: "Lab",
      leadAgentId: "openclaw:office",
      members: [{ agentId: "openclaw:office", roleInTeam: "lead" }],
    });
    const project = createAiProject({
      title: "Scan GPU",
      brief: "Surveiller eBay",
      goals: "Alerte prix",
      teamId: team.id,
      kind: "recurring",
      schedule: "quotidien 9h",
    });
    expect(project.brief).toMatch(/eBay/);
    expect(project.teamId).toBe(team.id);

    createOfficeTask({
      title: "Kickoff",
      phase: "meeting",
      status: "thinking",
      projectId: project.id,
      teamId: team.id,
    });
    createOfficeTask({
      title: "Build",
      phase: "execution",
      status: "working",
      projectId: project.id,
    });
    const active = listOfficeTasks({ status: "active" });
    expect(active.length).toBeGreaterThanOrEqual(2);
    const meeting = listOfficeTasks({ phase: "meeting" });
    expect(meeting.some((t) => t.title === "Kickoff")).toBe(true);
  });

  it("mission task + handoff vers mgr puis livraison user (idempotent)", () => {
    const team = createAgentTeam({
      name: "Chain",
      leadAgentId: "openclaw:chef",
      members: [
        { agentId: "openclaw:chef", roleInTeam: "lead" },
        { agentId: "openclaw:mgr-dev", roleInTeam: "mgr" },
        { agentId: "openclaw:main", roleInTeam: "worker" },
      ],
    });
    const cmd1 = enqueueOfficeCommand("openclaw:main", "message", { text: "mission code" });
    const task = createMissionTask({
      title: "Mission code",
      brief: "mission implémente feature X",
      assigneeAgentId: "openclaw:main",
      commandId: cmd1.id,
      teamId: team.id,
      multiAgent: true,
    });
    expect(task.phase).toBe("meeting");
    expect(peekNextHandoff(task)).toBe("openclaw:mgr-dev");

    // simule ack worker
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("done worker", new Date().toISOString(), cmd1.id);

    const after1 = processTaskAfterCommand(
      cmd1.id,
      "openclaw:main",
      "done",
      "Rapport worker: feature OK",
      task.id,
    );
    expect(after1?.status).toBe("handoff");
    expect(after1?.assigneeAgentId).toBe("openclaw:mgr-dev");
    expect(after1?.commandId).toBeTruthy();

    const handoffCmd = getOfficeCommand(after1!.commandId!);
    expect(handoffCmd?.agentId).toBe("openclaw:mgr-dev");
    expect(handoffCmd?.status).toBe("queued");

    // mgr done → lead
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("synthèse mgr", new Date().toISOString(), handoffCmd!.id);

    const after2 = processTaskAfterCommand(
      handoffCmd!.id,
      "openclaw:mgr-dev",
      "done",
      "Synthèse mgr OK",
      task.id,
    );
    expect(after2?.assigneeAgentId).toBe("openclaw:chef");

    const leadCmd = getOfficeCommand(after2!.commandId!);
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("ok chef", new Date().toISOString(), leadCmd!.id);

    const after3 = processTaskAfterCommand(
      leadCmd!.id,
      "openclaw:chef",
      "done",
      "Livré au boss",
      task.id,
    );
    expect(after3?.status).toBe("done");
    expect(after3?.phase).toBe("done");
    expect(after3?.meta.delivered).toBe(true);

    // idempotent
    const again = processTaskAfterCommand(
      leadCmd!.id,
      "openclaw:chef",
      "done",
      "Livré au boss",
      task.id,
    );
    expect(again?.meta.delivered).toBe(true);
    const queued = claimOfficeCommands("test", 10);
    // pas de nouvelle commande de double livraison
    expect(queued.every((c) => c.id !== leadCmd!.id)).toBe(true);
  });

  it("update phase blocked puis reprise", () => {
    const t = createOfficeTask({
      title: "Blocked",
      status: "working",
      phase: "execution",
      assigneeAgentId: "openclaw:mgr-lab",
    });
    updateOfficeTask(t.id, { status: "blocked" }, { kind: "status", text: "attente API" });
    expect(getOfficeTask(t.id)?.status).toBe("blocked");
    updateOfficeTask(t.id, { status: "working" }, { kind: "status", text: "reprise" });
    expect(getOfficeTask(t.id)?.status).toBe("working");
  });

  it("tâche réunion ignore handoff normal", () => {
    const cmd = enqueueOfficeCommand("openclaw:chef", "message", { text: "synthèse" });
    const task = createOfficeTask({
      title: "Réunion test",
      status: "working",
      phase: "meeting",
      assigneeAgentId: "openclaw:office",
      commandId: cmd.id,
      meta: { meeting: true },
    });
    const result = processTaskAfterCommand(cmd.id, "openclaw:chef", "done", "Synthèse OK", task.id);
    expect(result).toBeNull();
  });
});
