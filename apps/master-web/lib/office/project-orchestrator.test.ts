import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import { getAiProject } from "@/lib/db/ai-projects";
import { getAgentTeam } from "@/lib/db/agent-teams";
import { claimOfficeCommands, getOfficeCommand } from "@/lib/db/office";
import { getOfficeTask, listOfficeTasksByParent } from "@/lib/db/office-tasks";
import {
  SUBTASK_TIMEOUT_MS,
  answerBlockedQuestion,
  approvePlan,
  blockSubtaskWithQuestion,
  buildPmStatusReply,
  cancelPmProject,
  deliverProject,
  getOrchestration,
  processPmAfterCommand,
  processPmTimeouts,
  revisePlan,
  rollupProjectProgress,
  startPmProject,
  tickOrchestration,
} from "./project-orchestrator";

function ack(commandId: string, agentId: string, text: string, taskId: string) {
  getDb()
    .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
    .run(text, new Date().toISOString(), commandId);
  return processPmAfterCommand(commandId, agentId, "done", text, taskId);
}

describe("project-orchestrator", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-pm-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
    getDb();
  });
  afterEach(() => closeDb());

  it("start → awaiting approval", () => {
    const { project, rootTask, plan, reply } = startPmProject({
      brief: "Lance un projet eBay GPU avec équipe",
      title: "GPU eBay",
      facilitatorAgentId: "openclaw:office",
    });
    const orch = getOrchestration(getAiProject(project.id)!);
    expect(orch?.phase).toBe("awaiting_plan_approval");
    expect(rootTask.status).toBe("blocked");
    expect(plan.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(reply).toMatch(/ok go/i);
  });

  it("approve → team + children parentTaskId + tick parallèle", () => {
    const { project, rootTask } = startPmProject({
      brief: "projet eBay",
      title: "E1",
      facilitatorAgentId: "openclaw:office",
    });
    const r = approvePlan(project.id);
    expect(r.ok).toBe(true);
    expect(r.childCount).toBe(3);

    const children = listOfficeTasksByParent(rootTask.id);
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.parentTaskId === rootTask.id)).toBe(true);

    const team = getAgentTeam(r.teamId!);
    expect(team?.members.length).toBeGreaterThanOrEqual(3);

    // research + build sans deps → 2 commandes parallèles
    const working = children.filter((c) => c.status === "working");
    expect(working.length).toBe(2);
    const cmds = claimOfficeCommands("t", 10);
    expect(cmds.filter((c) => c.payload.pmSubtask === true).length).toBe(2);
  });

  it("DAG: review attend research+build", () => {
    const { project, rootTask } = startPmProject({
      brief: "dag",
      title: "DAG",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    let children = listOfficeTasksByParent(rootTask.id);
    const research = children.find((c) => c.meta.planSubtaskId === "research")!;
    const build = children.find((c) => c.meta.planSubtaskId === "build")!;
    const review = children.find((c) => c.meta.planSubtaskId === "review")!;
    expect(review.status).toBe("queued");

    ack(research.commandId!, research.assigneeAgentId!, "research ok", research.id);
    children = listOfficeTasksByParent(rootTask.id);
    expect(children.find((c) => c.id === review.id)?.status).toBe("queued");

    ack(build.commandId!, build.assigneeAgentId!, "build ok", build.id);
    children = listOfficeTasksByParent(rootTask.id);
    expect(children.find((c) => c.id === review.id)?.status).toBe("working");
  });

  it("rollup + status factuel", () => {
    const { project } = startPmProject({
      brief: "x",
      title: "Roll",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const rollup = rollupProjectProgress(project.id)!;
    expect(rollup.total).toBe(3);
    expect(rollup.working).toBe(2);
    expect(buildPmStatusReply("openclaw:office")).toMatch(/Roll|phase|termin/i);
  });

  it("cancel cascade", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "CancelMe",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const r = cancelPmProject({ titleQuery: "CancelMe" });
    expect(r.ok).toBe(true);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("cancelled");
    expect(getOfficeTask(rootTask.id)?.status).toBe("cancelled");
    expect(
      listOfficeTasksByParent(rootTask.id).every(
        (c) => c.status === "cancelled" || c.status === "done",
      ),
    ).toBe(true);
  });

  it("livraison idempotente après gate", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "Liv",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const children = listOfficeTasksByParent(rootTask.id);
    for (const c of children.filter((x) => x.status === "working")) {
      ack(c.commandId!, c.assigneeAgentId!, `ok ${c.meta.planSubtaskId}`, c.id);
    }
    // review now working
    const review = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "review",
    )!;
    ack(review.commandId!, review.assigneeAgentId!, "synthèse ok", review.id);

    const orch = getOrchestration(getAiProject(project.id)!)!;
    expect(orch.phase).toBe("awaiting_delivery_approval");

    const d1 = deliverProject(project.id);
    const d2 = deliverProject(project.id);
    expect(d1.ok).toBe(true);
    expect(d2.reply).toMatch(/Déjà livré/i);
    expect(getOrchestration(getAiProject(project.id)!)?.delivered).toBe(true);
  });

  it("blocked question → human answer → resume", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "Block",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    blockSubtaskWithQuestion(research.id, "API eBay dispo ?", {
      toAgentId: "openclaw:mgr-dev",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");

    const r = answerBlockedQuestion(project.id, "stub d'abord");
    expect(r.ok).toBe(true);
    expect(getOfficeTask(research.id)?.meta.humanAnswer).toMatch(/stub/i);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
  });

  it("processPmAfterCommand idempotent", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "Idem",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    ack(research.commandId!, research.assigneeAgentId!, "once", research.id);
    const again = processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      "once",
      research.id,
    );
    expect(again).toBeTruthy();
    const orch = getOrchestration(getAiProject(project.id)!)!;
    expect(orch.processedCommands.filter((id) => id === research.commandId).length).toBe(1);
  });

  it("timeout escalation", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "TO",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    const old = new Date(Date.now() - SUBTASK_TIMEOUT_MS - 1000).toISOString();
    getDb()
      .prepare(`UPDATE office_tasks SET updated_at = ? WHERE id = ?`)
      .run(old, research.id);

    const n = processPmTimeouts(Date.now());
    expect(n).toBeGreaterThanOrEqual(1);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");
  });

  it("revise garde awaiting_plan_approval", () => {
    const { project } = startPmProject({
      brief: "x",
      title: "Rev",
      facilitatorAgentId: "openclaw:office",
    });
    revisePlan(project.id, "ajoute mgr-lab pour veille");
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_plan_approval");
    expect(getOrchestration(getAiProject(project.id)!)?.revisionNotes.length).toBe(1);
  });

  it("tick idempotent sans double enqueue", () => {
    const { project } = startPmProject({
      brief: "x",
      title: "Tick",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const first = claimOfficeCommands("a", 10).length;
    tickOrchestration(project.id);
    const second = claimOfficeCommands("b", 10).length;
    expect(second).toBe(0);
    expect(first).toBe(2);
  });
});
