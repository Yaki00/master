/**
 * Scénarios multi-étapes sur sujets divers (PM, réunion, mail, archives, handoff).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import {
  appendOfficeEvent,
  clearOfficeEvents,
  claimOfficeCommands,
  listOfficeEvents,
  upsertOfficeAgent,
} from "@/lib/db/office";
import {
  getOfficeConversationDetail,
  listOfficeConversations,
} from "@/lib/db/office-conversations";
import { getAiProject, listAiProjects } from "@/lib/db/ai-projects";
import { getOfficeTask, listOfficeTasksByParent } from "@/lib/db/office-tasks";
import { dispatchOfficeAction } from "@/lib/office/actions";
import {
  processMeetingAfterCommand,
  startAllHandsMeeting,
  buildMeetingStatusReply,
} from "@/lib/office/meeting";
import {
  answerBlockedQuestion,
  approvePlan,
  blockSubtaskWithQuestion,
  deliverProject,
  getOrchestration,
  processPmAfterCommand,
  startPmProject,
} from "@/lib/office/project-orchestrator";
import {
  getSetupSession,
  handleSetupMessage,
  startMailSetup,
} from "@/lib/office/setup-session";
import {
  createMissionTask,
  processTaskAfterCommand,
} from "@/lib/office/handoff";
import { createAgentTeam } from "@/lib/db/agent-teams";
import { enqueueOfficeCommand } from "@/lib/db/office";

vi.mock("@/lib/office/mail-imap", () => ({
  verifyMailImap: vi.fn(async () => ({ ok: true, mailbox: "INBOX" })),
  fetchInboxPreview: vi.fn(async () => ({ ok: true, messages: [] })),
  formatInboxBrief: vi.fn(() => ""),
}));

function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.MASTER_DB_PATH = join(dir, "t.db");
  closeDb();
  getDb();
}

function seedOffice() {
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

function ackPm(commandId: string, agentId: string, text: string, taskId: string) {
  getDb()
    .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
    .run(text, new Date().toISOString(), commandId);
  return processPmAfterCommand(commandId, agentId, "done", text, taskId);
}

const SOLID = (label: string) =>
  `Livrable ${label}: analyse détaillée, contraintes listées, prochaines étapes claires et actionnables pour livraison.`;

describe("MS-01 — projet eBay multi-étapes jusqu’à livraison", () => {
  beforeEach(() => {
    freshDb("master-ms01-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("brief → plan → ok go → DAG → gate → livraison", async () => {
    const start = await dispatchOfficeAction("openclaw:office", "message", {
      text: "Lance un projet surveillance prix RTX 4090 eBay avec une équipe adaptée",
    });
    expect(start.ok).toBe(true);

    const project = listAiProjects().find(
      (p) => getOrchestration(p)?.phase === "awaiting_plan_approval",
    )!;
    expect(project).toBeTruthy();

    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");

    const rootId = getOrchestration(getAiProject(project.id)!)!.rootTaskId;
    let children = listOfficeTasksByParent(rootId);
    const research = children.find((c) => c.meta.planSubtaskId === "research")!;
    const build = children.find((c) => c.meta.planSubtaskId === "build")!;
    expect(research.status).toBe("working");
    expect(build.status).toBe("working");

    ackPm(research.commandId!, research.assigneeAgentId!, SOLID("research eBay"), research.id);
    ackPm(build.commandId!, build.assigneeAgentId!, SOLID("build alerte"), build.id);

    children = listOfficeTasksByParent(rootId);
    const review = children.find((c) => c.meta.planSubtaskId === "review")!;
    expect(review.status).toBe("working");
    ackPm(review.commandId!, review.assigneeAgentId!, SOLID("revue synthèse marché"), review.id);

    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_delivery_approval");

    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("delivered");
    expect(getOrchestration(getAiProject(project.id)!)?.delivered).toBe(true);
  });
});

describe("MS-02 — mail wizard multi-tours puis annulation", () => {
  beforeEach(() => {
    freshDb("master-ms02-");
    process.env.NEXTAUTH_SECRET = "test-secret-for-aes-256-gcm-key!!";
    seedOffice();
  });
  afterEach(() => closeDb());

  it("connect → host → user → annuler", async () => {
    startMailSetup("openclaw:office", "analyze");
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_host");

    let r = await handleSetupMessage("openclaw:office", "imap.example.com");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")?.step).toMatch(/user|ask_user/);

    r = await handleSetupMessage("openclaw:office", "yaki@example.com");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")?.step).toMatch(/pass|ask_pass/);

    r = await handleSetupMessage("openclaw:office", "annuler");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")).toBeNull();
  });
});

describe("MS-03 — réunion all-hands multi-étapes", () => {
  beforeEach(() => {
    freshDb("master-ms03-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("lancer → 2 réponses → statut → synthèse partielle via timeout path", async () => {
    const task = startAllHandsMeeting({
      brief: "Trouver le meilleur objet à vendre sur eBay cette semaine",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as { agentId: string; commandId: string | null }[];
    expect(parts.length).toBeGreaterThanOrEqual(3);

    const a = parts[0]!;
    const b = parts[1]!;
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("Niche GPU reconditionnés", new Date().toISOString(), a.commandId!);
    processMeetingAfterCommand(
      a.commandId!,
      a.agentId,
      "done",
      "Niche GPU reconditionnés avec marge correcte",
      task.id,
    );
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("Accessoires photo", new Date().toISOString(), b.commandId!);
    processMeetingAfterCommand(
      b.commandId!,
      b.agentId,
      "done",
      "Accessoires photo volume + marge",
      task.id,
    );

    const status = buildMeetingStatusReply("openclaw:office");
    expect(status).toMatch(/2\/|répondu|Réunion/i);

    const after = getOfficeTask(task.id)!;
    const doneCount = (after.meta.participants as { status: string }[]).filter(
      (p) => p.status === "done",
    ).length;
    expect(doneCount).toBeGreaterThanOrEqual(2);
  });
});

describe("MS-04 — nouvelle discussion archive le fil par agent", () => {
  beforeEach(() => {
    freshDb("master-ms04-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("messages → clear → archive + fil neuf ; 2e agent isolé", () => {
    upsertOfficeAgent({
      id: "openclaw:chef",
      kind: "openclaw",
      name: "Chef",
      status: "idle",
      task: null,
      currentAction: null,
      lastSeenAt: new Date().toISOString(),
      meta: {},
    });

    appendOfficeEvent("openclaw:office", "user_message", {
      text: "Analyse le marché GPU pour Pixel Brain",
      role: "user",
    });
    appendOfficeEvent("openclaw:office", "agent_message", {
      text: "Je prépare un plan d'équipe pour la veille GPU.",
      role: "agent",
    });
    appendOfficeEvent("openclaw:chef", "user_message", {
      text: "Priorise les niches eBay",
      role: "user",
    });
    appendOfficeEvent("openclaw:chef", "agent_message", {
      text: "Priorité: GPU reconditionnés puis accessoires.",
      role: "agent",
    });

    const cleared = clearOfficeEvents("openclaw:office");
    expect(cleared).toBeGreaterThanOrEqual(2);

    const archives = listOfficeConversations("openclaw:office", { status: "archived" });
    expect(archives.length).toBe(1);
    expect(archives[0]!.title).toMatch(/GPU|marché/i);
    expect(archives[0]!.messageCount).toBeGreaterThanOrEqual(2);

    const detail = getOfficeConversationDetail(archives[0]!.id)!;
    expect(detail.events.some((e) => /GPU/i.test(String(e.payload.text ?? "")))).toBe(true);

    const live = listOfficeEvents("openclaw:office", 20);
    expect(live.some((e) => e.payload.newDiscussion === true)).toBe(true);
    expect(live.some((e) => e.kind === "user_message" && /Analyse le marché/i.test(String(e.payload.text)))).toBe(
      false,
    );

    // Chef inchangé
    expect(listOfficeEvents("openclaw:chef", 10).some((e) => /Priorise/i.test(String(e.payload.text)))).toBe(
      true,
    );
    expect(listOfficeConversations("openclaw:chef", { status: "archived" })).toHaveLength(0);

    clearOfficeEvents("openclaw:chef");
    expect(listOfficeConversations("openclaw:chef", { status: "archived" })).toHaveLength(1);

    // 2e discussion office
    appendOfficeEvent("openclaw:office", "user_message", { text: "Nouveau sujet mail", role: "user" });
    appendOfficeEvent("openclaw:office", "agent_message", { text: "OK on parle mail.", role: "agent" });
    clearOfficeEvents("openclaw:office");
    expect(listOfficeConversations("openclaw:office", { status: "archived" }).length).toBe(2);
  });
});

describe("MS-05 — handoff mission multi-agents", () => {
  beforeEach(() => {
    freshDb("master-ms05-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("worker → mgr → lead → user", () => {
    const team = createAgentTeam({
      name: "Dev HQ",
      leadAgentId: "openclaw:chef",
      members: [
        { agentId: "openclaw:main", roleInTeam: "worker", sortOrder: 0 },
        { agentId: "openclaw:mgr-dev", roleInTeam: "mgr", sortOrder: 1 },
        { agentId: "openclaw:chef", roleInTeam: "lead", sortOrder: 2 },
      ],
    });
    const cmd = enqueueOfficeCommand("openclaw:main", "message", { text: "scan ebay" });
    const task = createMissionTask({
      title: "Scan eBay GPU",
      brief: "mission délègue scan ebay",
      assigneeAgentId: "openclaw:main",
      commandId: cmd.id,
      teamId: team.id,
      multiAgent: true,
    });

    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("scan ok", new Date().toISOString(), cmd.id);
    processTaskAfterCommand(cmd.id, "openclaw:main", "done", "scan ok résultats", task.id);

    const after1 = getOfficeTask(task.id)!;
    expect(after1.status).toBe("handoff");
    const mgrCmd = claimOfficeCommands("t", 5).find((c) => c.agentId === "openclaw:mgr-dev");
    expect(mgrCmd).toBeTruthy();

    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("mgr ok", new Date().toISOString(), mgrCmd!.id);
    processTaskAfterCommand(mgrCmd!.id, "openclaw:mgr-dev", "done", "validation mgr", task.id);

    const chefCmd = claimOfficeCommands("t2", 5).find((c) => c.agentId === "openclaw:chef");
    expect(chefCmd).toBeTruthy();
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("lead ok", new Date().toISOString(), chefCmd!.id);
    processTaskAfterCommand(chefCmd!.id, "openclaw:chef", "done", "synthèse lead", task.id);

    expect(getOfficeTask(task.id)?.status).toBe("done");
    expect(getOfficeTask(task.id)?.meta.delivered).toBe(true);
  });
});

describe("MS-06 — blocage PM + réponse humaine + reprise", () => {
  beforeEach(() => {
    freshDb("master-ms06-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("block → answer via dispatch → sous-tâche relancée", async () => {
    const { project, rootTask } = startPmProject({
      brief: "Lance un projet connecteur eBay avec équipe",
      title: "MS06",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    blockSubtaskWithQuestion(research.id, "API eBay live ou stub ?", {
      toAgentId: "openclaw:mgr-dev",
    });

    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "stub d'abord puis API plus tard",
    });
    expect(res.ok).toBe(true);
    expect(getOfficeTask(research.id)?.meta.humanAnswer).toMatch(/stub/i);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
    expect(getOfficeTask(research.id)?.status).toBe("working");
  });
});

describe("MS-07 — livraison refusée puis reprise review", () => {
  beforeEach(() => {
    freshDb("master-ms07-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("gate → révision → review working à nouveau", () => {
    const { project, rootTask } = startPmProject({
      brief: "projet",
      title: "MS07",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const children = listOfficeTasksByParent(rootTask.id);
    for (const c of children.filter((x) => x.status === "working")) {
      ackPm(c.commandId!, c.assigneeAgentId!, SOLID(String(c.meta.planSubtaskId)), c.id);
    }
    const review = listOfficeTasksByParent(rootTask.id).find((c) => c.meta.planSubtaskId === "review")!;
    ackPm(review.commandId!, review.assigneeAgentId!, SOLID("review"), review.id);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_delivery_approval");

    const r = answerBlockedQuestion(project.id, "révision ajoute les prix cibles");
    expect(r.ok).toBe(true);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
    expect(getOfficeTask(review.id)?.status).toBe("working");

    ackPm(
      getOfficeTask(review.id)!.commandId!,
      review.assigneeAgentId!,
      SOLID("review avec prix cibles détaillés"),
      review.id,
    );
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_delivery_approval");
    deliverProject(project.id);
    expect(getOrchestration(getAiProject(project.id)!)?.delivered).toBe(true);
  });
});

describe("MS-08 — soft-fail livrable trop court puis retry OK", () => {
  beforeEach(() => {
    freshDb("master-ms08-");
    seedOffice();
  });
  afterEach(() => closeDb());

  it("ok trop court → retry → livrable solide", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "MS08",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    processPmAfterCommand(research.commandId!, research.assigneeAgentId!, "done", "ok", research.id);
    expect(Number(getOfficeTask(research.id)?.meta.retryCount)).toBe(1);
    expect(getOfficeTask(research.id)?.status).toBe("working");

    const cmd2 = getOfficeTask(research.id)!.commandId!;
    ackPm(cmd2, research.assigneeAgentId!, SOLID("research"), research.id);
    expect(getOfficeTask(research.id)?.status).toBe("done");
  });
});
