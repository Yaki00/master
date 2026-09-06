/**
 * Scénarios multi-tours — humain ↔ secrétaire ↔ agents.
 * Référence CDC : docs/CDC-ORCHESTRATION-PM-2026-08-25.md
 *
 * OS-01..10 : scénarios multi-tours (must pass CI)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import { createAgentTeam } from "@/lib/db/agent-teams";
import {
  claimOfficeCommands,
  completeOfficeCommand,
  enqueueOfficeCommand,
  getOfficeCommand,
  listOfficeEvents,
  upsertOfficeAgent,
} from "@/lib/db/office";
import {
  createOfficeTask,
  getOfficeTask,
  listOfficeTasks,
  listOfficeTasksByParent,
  updateOfficeTask,
} from "@/lib/db/office-tasks";
import { listAiProjects, getAiProject } from "@/lib/db/ai-projects";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { eventsToBubbles } from "@/lib/office/chat";
import {
  createMissionTask,
  peekNextHandoff,
  processTaskAfterCommand,
} from "@/lib/office/handoff";
import {
  buildMeetingStatusReply,
  processMeetingAfterCommand,
  startAllHandsMeeting,
} from "@/lib/office/meeting";
import {
  getSetupSession,
  handleSetupMessage,
  startMailSetup,
} from "@/lib/office/setup-session";
import {
  approvePlan,
  blockSubtaskWithQuestion,
  buildPmStatusReply,
  getOrchestration,
  processPmAfterCommand,
  startPmProject,
  tickOrchestration,
} from "@/lib/office/project-orchestrator";
import { getDb } from "@/lib/db/sqlite";

vi.mock("@/lib/office/mail-imap", () => ({
  verifyMailImap: vi.fn(async () => ({ ok: true, mailbox: "INBOX" })),
  fetchInboxPreview: vi.fn(async () => ({ ok: true, messages: [] })),
  formatInboxBrief: vi.fn(() => ""),
}));

vi.mock("@/lib/office/infisical-mail", () => ({
  syncMailSecretsToInfisical: vi.fn(async () => ({ ok: false, detail: "skip test" })),
  isInfisicalConfigured: vi.fn(() => false),
}));

function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.MASTER_DB_PATH = join(dir, "t.db");
  process.env.NEXTAUTH_SECRET = "test-secret-for-aes-256-gcm-key!!";
  closeDb();
  getDb();
}

function seedOfficeAgent() {
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
}

/** Simule ack bridge : commande done + processTaskAfterCommand */
function ackAgent(
  commandId: string,
  agentId: string,
  resultText: string,
  taskId?: string | null,
) {
  getDb()
    .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
    .run(resultText, new Date().toISOString(), commandId);
  return processTaskAfterCommand(commandId, agentId, "done", resultText, taskId);
}

describe("OS-01 — réunion multi-agents puis question humain (H→S→4A→H)", () => {
  beforeEach(() => {
    freshDb("master-os01-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("4 agents répondent, humain demande status, réponse factuelle", async () => {
    const brief = "meilleur GPU eBay sous 400€";
    const task = startAllHandsMeeting({
      brief,
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;
    expect(parts).toHaveLength(4);

    // Tour 1–4 : agents répondent (simulation bridge)
    processMeetingAfterCommand(parts[0]!.commandId, parts[0]!.agentId, "done", "RTX 4090 à 390€");
    processMeetingAfterCommand(parts[1]!.commandId, parts[1]!.agentId, "done", "RX 7900 XTX intéressant");

    // Tour 5 : humain demande nouvelles à la secrétaire
    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "alors des nouvelles de la réunion ?",
    });
    expect(res.ok).toBe(true);

    const reply = buildMeetingStatusReply("openclaw:office");
    expect(reply).toMatch(/RTX 4090|390/);
    expect(reply).toMatch(/2\/4|en cours/i);
    expect(reply).not.toMatch(/hallucin/i);

    // Tour 6–7 : agents restants + synthèse chef enqueued
    processMeetingAfterCommand(parts[2]!.commandId, parts[2]!.agentId, "done", "Veille LeBonCoin");
    processMeetingAfterCommand(parts[3]!.commandId, parts[3]!.agentId, "done", "Alerte prix recommandée");

    const updated = getOfficeTask(task.id);
    expect(updated?.meta.synthesisCommandId).toBeTruthy();
  });
});

describe("OS-02 — mission handoff séquentiel agent↔agent jusqu’à humain (H→S→A→A→A→H)", () => {
  beforeEach(() => {
    freshDb("master-os02-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("worker → mgr-dev → chef → livraison user, multi-tours ack", async () => {
    const team = createAgentTeam({
      name: "Dev Squad",
      leadAgentId: "openclaw:chef",
      members: [
        { agentId: "openclaw:chef", roleInTeam: "lead" },
        { agentId: "openclaw:mgr-dev", roleInTeam: "mgr" },
        { agentId: "openclaw:main", roleInTeam: "worker" },
      ],
    });

    // Tour 1 : humain confie mission à la secrétaire (sans mots sentinelle/RTX)
    const speech =
      "Mission : implémente le connecteur eBay pour notifications prix, délègue à l'équipe dev";
    const res = await dispatchOfficeAction("openclaw:office", "message", { text: speech });
    expect(res.ok).toBe(true);
    const humanEvents = listOfficeEvents("openclaw:office");
    expect(humanEvents.some((e) => e.kind === "user_message")).toBe(true);

    // Tour 2 : secrétaire délègue au worker (simule orchestrateur PM — auto-delegation = OS-06)
    const cmd1 = enqueueOfficeCommand("openclaw:main", "message", {
      text: speech,
      teamId: team.id,
      delegatedFrom: "openclaw:office",
    });
    const task = createMissionTask({
      title: "Connecteur eBay",
      brief: speech,
      assigneeAgentId: "openclaw:main",
      commandId: cmd1.id,
      teamId: team.id,
      multiAgent: true,
    });
    expect(peekNextHandoff(task)).toBe("openclaw:mgr-dev");

    // Tour 3 : main (worker) termine
    const afterWorker = ackAgent(cmd1.id, "openclaw:main", "Connecteur stub prêt, tests OK", task.id);
    expect(afterWorker?.assigneeAgentId).toBe("openclaw:mgr-dev");
    expect(afterWorker?.status).toBe("handoff");

    const mgrCmd = getOfficeCommand(afterWorker!.commandId!);
    expect(mgrCmd?.agentId).toBe("openclaw:mgr-dev");

    // Tour 4 : mgr-dev valide et handoff chef
    const afterMgr = ackAgent(mgrCmd!.id, "openclaw:mgr-dev", "Revue OK, prêt pour synthèse chef", task.id);
    expect(afterMgr?.assigneeAgentId).toBe("openclaw:chef");

    const chefCmd = getOfficeCommand(afterMgr!.commandId!);
    // Tour 5 : chef livre
    const afterChef = ackAgent(chefCmd!.id, "openclaw:chef", "Projet livré : connecteur eBay opérationnel", task.id);
    expect(afterChef?.status).toBe("done");
    expect(afterChef?.meta.delivered).toBe(true);

    // Tour 6 : humain — pas de double livraison
    const events = listOfficeEvents("openclaw:office");
    const bubbles = eventsToBubbles(events);
    expect(bubbles.length).toBeGreaterThanOrEqual(0);

    const again = ackAgent(chefCmd!.id, "openclaw:chef", "Projet livré : connecteur eBay opérationnel", task.id);
    expect(again?.meta.delivered).toBe(true);
    const extra = claimOfficeCommands("bridge-test", 5);
    expect(extra.filter((c) => c.payload.handoff === true && c.payload.taskId === task.id).length).toBe(0);
  });
});

describe("OS-03 — wizard mail multi-tours humain↔secrétaire (H↔S×5)", () => {
  beforeEach(() => {
    freshDb("master-os03-");
    seedOfficeAgent();
    delete process.env.MAIL_IMAP_HOST;
    delete process.env.MAIL_IMAP_USER;
    delete process.env.MAIL_IMAP_PASS;
  });
  afterEach(() => closeDb());

  it("4 questions IMAP puis verify, ou annulation mid-flight", async () => {
    // Parcours complet
    startMailSetup("openclaw:office", "analyze");
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_host");

    let r = await handleSetupMessage("openclaw:office", "imap.mail.ovh.net");
    expect(r.reply).toMatch(/2\/4/);

    r = await handleSetupMessage("openclaw:office", "moi@pixelbrain.fr");
    expect(r.reply).toMatch(/3\/4/);

    r = await handleSetupMessage("openclaw:office", "secret-pass-123");
    expect(r.reply).toMatch(/4\/4/);

    const leaked = listOfficeEvents("openclaw:office").some((e) =>
      String((e.payload as { text?: string }).text || "").includes("secret-pass"),
    );
    expect(leaked).toBe(false);

    r = await handleSetupMessage("openclaw:office", "993");
    expect(r.completed).toBe(true);
    expect(r.launchMail).toBe("analyze");
    expect(getSetupSession("openclaw:office")).toBeNull();

    // Parcours annulation
    startMailSetup("openclaw:office", null);
    r = await handleSetupMessage("openclaw:office", "annuler");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")).toBeNull();
  });
});

describe("OS-04 — projet complexe speech → DB (H→S)", () => {
  beforeEach(() => {
    freshDb("master-os04-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("crée projet récurrent sentinelle depuis langage naturel", async () => {
    const speech =
      'Crée un projet « Sentinelle GPU » récurrent pour surveiller RTX 4090 <400€ sur eBay toutes les 30 min';
    const res = await dispatchOfficeAction("openclaw:office", "message", { text: speech });
    expect(res.ok).toBe(true);

    const projects = listAiProjects();
    const hit = projects.find((p) => /Sentinelle GPU/i.test(p.title));
    expect(hit).toBeTruthy();
    expect(hit?.kind).toBe("recurring");
    expect(hit?.brief).toMatch(/4090|eBay/i);
  });
});

describe("OS-05 — question bloquante inter-agents (A→A→H→A)", () => {
  beforeEach(() => {
    freshDb("master-os05-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("blockSubtask → réponse humaine via dispatch → reprise", async () => {
    const { project, rootTask } = startPmProject({
      brief: "Lance un projet eBay avec équipe",
      title: "OS05",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    blockSubtaskWithQuestion(research.id, "API eBay branchée ou stub ?", {
      toAgentId: "openclaw:mgr-dev",
    });

    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "pas encore, stub d'abord",
    });
    expect(res.ok).toBe(true);
    expect(getOfficeTask(research.id)?.meta.humanAnswer).toMatch(/stub/i);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
  });
});

describe("OS-06 — plan → gate humain → équipe + sous-tâches", () => {
  beforeEach(() => {
    freshDb("master-os06-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("dispatch mission longue → PM sans formule « lance un projet »", async () => {
    const start = await dispatchOfficeAction("openclaw:office", "message", {
      text: "Délègue une mission : analyser le marché GPU eBay et proposer un plan d'équipe adapté",
    });
    expect(start.ok).toBe(true);
    const hit = listAiProjects().find((p) => getOrchestration(p)?.phase === "awaiting_plan_approval");
    expect(hit).toBeTruthy();
  });

  it("dispatch start + ok go materialise équipe et parentTaskId", async () => {
    const start = await dispatchOfficeAction("openclaw:office", "message", {
      text: "Lance un projet surveillance prix eBay avec une équipe adaptée",
    });
    expect(start.ok).toBe(true);

    const projects = listAiProjects();
    const hit = projects.find((p) => getOrchestration(p)?.phase === "awaiting_plan_approval");
    expect(hit).toBeTruthy();

    const approve = await dispatchOfficeAction("openclaw:office", "message", {
      text: "ok go",
    });
    expect(approve.ok).toBe(true);

    const orch = getOrchestration(getAiProject(hit!.id)!)!;
    expect(orch.planApproved).toBe(true);
    expect(orch.teamId).toBeTruthy();
    expect(Object.keys(orch.subtaskMap).length).toBe(3);

    const children = listOfficeTasksByParent(orch.rootTaskId);
    expect(children.every((c) => c.parentTaskId === orch.rootTaskId)).toBe(true);
  });
});

describe("OS-07 — sous-tâches parallèles DAG", () => {
  beforeEach(() => {
    freshDb("master-os07-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("research et build lancés en parallèle, review après", () => {
    const { project, rootTask } = startPmProject({
      brief: "projet DAG",
      title: "OS07",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const children = listOfficeTasksByParent(rootTask.id);
    const parallel = children.filter((c) =>
      ["research", "build"].includes(String(c.meta.planSubtaskId)),
    );
    expect(parallel.every((c) => c.status === "working")).toBe(true);
    expect(children.find((c) => c.meta.planSubtaskId === "review")?.status).toBe("queued");
  });
});

describe("OS-08 — rollup statut factuel", () => {
  beforeEach(() => {
    freshDb("master-os08-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("où en est-on répond depuis DB", async () => {
    const { project, rootTask } = startPmProject({
      brief: "projet",
      title: "OS08",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("done", new Date().toISOString(), research.commandId!);
    processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      "Livrable research: sources eBay listées, contraintes prix et catégories détaillées.",
      research.id,
    );

    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "où en est-on ?",
    });
    expect(res.ok).toBe(true);
    const reply = buildPmStatusReply("openclaw:office");
    expect(reply).toMatch(/1\/3|33%|OS08/i);
    expect(reply).not.toMatch(/hallucin/i);
  });
});

describe("OS-09 — annulation cascade", () => {
  beforeEach(() => {
    freshDb("master-os09-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("annule le projet cascade parentTaskId", async () => {
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "Lance un projet OS09Cancel avec une équipe",
    });
    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });

    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "annule le projet OS09Cancel",
    });
    expect(res.ok).toBe(true);
    const hit = listAiProjects().find((p) => /OS09Cancel/i.test(p.title));
    expect(getOrchestration(hit!)?.phase).toBe("cancelled");
  });
});

describe("OS-10 — reprise crash (état SQLite)", () => {
  beforeEach(() => {
    freshDb("master-os10-");
    seedOfficeAgent();
  });
  afterEach(() => closeDb());

  it("état orchestration relu après closeDb/reopen", () => {
    const { project } = startPmProject({
      brief: "crash test",
      title: "OS10",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const before = getOrchestration(getAiProject(project.id)!)!;
    expect(before.phase).toBe("executing");

    closeDb();
    getDb();

    const after = getOrchestration(getAiProject(project.id)!)!;
    expect(after.phase).toBe("executing");
    expect(after.subtaskMap).toEqual(before.subtaskMap);
    expect(after.rootTaskId).toBe(before.rootTaskId);
    tickOrchestration(project.id);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
  });
});
