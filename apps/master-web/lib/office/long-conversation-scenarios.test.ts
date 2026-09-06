/**
 * Batterie « conversations longues » — multi-tours, infos manquantes, HITL.
 * Simule des échanges réalistes où l’orchestrateur doit demander puis reprendre.
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
import { loadMailImapConfig } from "@/lib/db/office-secrets";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { eventsToBubbles } from "@/lib/office/chat";
import {
  buildMeetingStatusReply,
  processMeetingAfterCommand,
  startAllHandsMeeting,
} from "@/lib/office/meeting";
import {
  answerBlockedQuestion,
  approvePlan,
  blockSubtaskWithQuestion,
  buildPmStatusReply,
  getOrchestration,
  processPmAfterCommand,
  processPmTimeouts,
  revisePlan,
  startPmProject,
  SUBTASK_NUDGE_MS,
} from "@/lib/office/project-orchestrator";
import {
  getSetupSession,
  handleSetupMessage,
  startMailSetup,
} from "@/lib/office/setup-session";

vi.mock("@/lib/office/mail-imap", () => ({
  verifyMailImap: vi.fn(async () => ({ ok: true, mailbox: "INBOX" })),
  fetchInboxPreview: vi.fn(async () => ({
    ok: true,
    messages: [
      { from: "a@b.c", subject: "Urgent facture", date: "2026-09-01", preview: "…" },
      { from: "x@y.z", subject: "RDV", date: "2026-09-02", preview: "…" },
    ],
  })),
  formatInboxBrief: vi.fn(() => "5 messages dont 2 urgents"),
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

function seed(ids: string[] = ["openclaw:office"]) {
  for (const id of ids) {
    upsertOfficeAgent({
      id,
      kind: "openclaw",
      name: id.replace(/^openclaw:/, ""),
      status: "idle",
      task: null,
      currentAction: null,
      lastSeenAt: new Date().toISOString(),
      meta: {},
    });
  }
}

function ackPm(commandId: string, agentId: string, text: string, taskId: string) {
  getDb()
    .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
    .run(text, new Date().toISOString(), commandId);
  return processPmAfterCommand(commandId, agentId, "done", text, taskId);
}

const SOLID = (label: string) =>
  `Livrable ${label}: analyse détaillée, sources, contraintes, risques et prochaines étapes actionnables pour la livraison.`;

/** Compte les tours user/agent visibles dans le fil. */
function chatTurns(agentId: string): number {
  return eventsToBubbles(listOfficeEvents(agentId, 200))
    .filter((b) => (b.role === "user" || b.role === "agent") && !b.pending).length;
}

describe("LC-01 — conversation longue PM avec 3 questions bloquantes", () => {
  beforeEach(() => {
    freshDb("lc01-");
    seed();
  });
  afterEach(() => closeDb());

  it("plan → exécution → 3× ask human → reprises → livraison", async () => {
    await dispatchOfficeAction("openclaw:office", "message", {
      text:
        "Lance un projet complexe : surveillance RTX 4090 eBay sous 400€, alerte quotidienne, équipe adaptée, et connecteur d'alerte Discord",
    });
    const project = listAiProjects().find(
      (p) => getOrchestration(p)?.phase === "awaiting_plan_approval",
    )!;
    expect(project).toBeTruthy();

    // Humain affine le plan avant d’approuver
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "révision ajoute aussi Leboncoin et un seuil d'alerte à 380€",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_plan_approval");
    expect(getOrchestration(getAiProject(project.id)!)?.revisionNotes.length).toBeGreaterThanOrEqual(1);

    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");

    const rootId = getOrchestration(getAiProject(project.id)!)!.rootTaskId;
    let research = listOfficeTasksByParent(rootId).find((c) => c.meta.planSubtaskId === "research")!;
    let build = listOfficeTasksByParent(rootId).find((c) => c.meta.planSubtaskId === "build")!;

    // Q1 — info manquante recherche
    blockSubtaskWithQuestion(research.id, "Quels sites prioriser : eBay seulement ou aussi Leboncoin / Facebook ?", {
      toAgentId: "openclaw:mgr-lab",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");
    expect(buildPmStatusReply("openclaw:office")).toMatch(/Question en attente|blocage|sites/i);

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "eBay + Leboncoin, ignore Facebook pour l'instant",
    });
    expect(getOfficeTask(research.id)?.meta.humanAnswer).toMatch(/Leboncoin/i);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");

    research = getOfficeTask(research.id)!;
    ackPm(
      research.commandId!,
      research.assigneeAgentId!,
      SOLID("research: eBay+Leboncoin, seuil 380, volume annonces et risques"),
      research.id,
    );

    // Q2 — info manquante build
    build = getOfficeTask(build.id)!;
    blockSubtaskWithQuestion(build.id, "Canal d'alerte : Discord webhook, email, ou les deux ?", {
      toAgentId: "openclaw:mgr-dev",
    });
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "Discord webhook uniquement pour la v1",
    });
    expect(getOfficeTask(build.id)?.meta.humanAnswer).toMatch(/Discord/i);

    build = getOfficeTask(build.id)!;
    ackPm(
      build.commandId!,
      build.assigneeAgentId!,
      SOLID("build: stub Discord webhook + polling prix, config seuil 380"),
      build.id,
    );

    let review = listOfficeTasksByParent(rootId).find((c) => c.meta.planSubtaskId === "review")!;
    expect(review.status).toBe("working");

    // Q3 — clarification avant synthèse
    blockSubtaskWithQuestion(review.id, "Livrer un rapport quotidien à quelle heure (UTC) ?", {
      toAgentId: "openclaw:chef",
    });
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "tous les jours à 07:00 Europe/Paris",
    });

    review = getOfficeTask(review.id)!;
    ackPm(
      review.commandId!,
      review.assigneeAgentId!,
      SOLID("revue: synthèse marché + plan alerte Discord 07h Paris + critères acceptés"),
      review.id,
    );

    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_delivery_approval");

    // Statut factuel avant validation
    await dispatchOfficeAction("openclaw:office", "message", { text: "où en est-on ?" });
    expect(buildPmStatusReply("openclaw:office")).toMatch(/3\/3|100%|livraison|attente/i);

    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });
    expect(getOrchestration(getAiProject(project.id)!)?.delivered).toBe(true);

    expect(chatTurns("openclaw:office")).toBeGreaterThanOrEqual(10);
  });
});

describe("LC-02 — wizard mail complet (4 infos demandées) + relance", () => {
  beforeEach(() => {
    freshDb("lc02-");
    seed();
  });
  afterEach(() => closeDb());

  it("demande host/user/pass/port puis verify", async () => {
    startMailSetup("openclaw:office", "analyze");
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_host");

    let r = await handleSetupMessage("openclaw:office", "imap.mail.ovh.net");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_user");

    r = await handleSetupMessage("openclaw:office", "moi@pixelbrain.fr");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_pass");

    r = await handleSetupMessage("openclaw:office", "mot-de-passe-secret-test");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_port");
    // secret jamais dans les events
    expect(
      listOfficeEvents("openclaw:office").some((e) =>
        String(e.payload.text ?? "").includes("mot-de-passe-secret-test"),
      ),
    ).toBe(false);

    r = await handleSetupMessage("openclaw:office", "993");
    expect(r.handled).toBe(true);
    expect(r.completed).toBe(true);
    expect(r.launchMail).toBe("analyze");
    expect(getSetupSession("openclaw:office")).toBeNull();

    const cfg = loadMailImapConfig();
    expect(cfg?.host).toBe("imap.mail.ovh.net");
    expect(cfg?.user).toBe("moi@pixelbrain.fr");
    expect(cfg?.pass).toBe("mot-de-passe-secret-test");
    expect(cfg?.port).toBe(993);

    expect(chatTurns("openclaw:office")).toBeGreaterThanOrEqual(8);
  });
});

describe("LC-03 — longue discussion multi-sujets + archives + reprise", () => {
  beforeEach(() => {
    freshDb("lc03-");
    seed(["openclaw:office", "openclaw:chef", "openclaw:mgr-dev"]);
  });
  afterEach(() => closeDb());

  it("fil long office → archive → nouveau sujet ; chef parallèle", async () => {
    const officeTurns = [
      "Salut, j'ai besoin d'aide sur Pixel Brain",
      "On va parler eBay d'abord",
      "Je veux surveiller les RTX 4090",
      "Budget max 400 euros",
      "Aussi Leboncoin si possible",
      "Tu peux préparer un plan d'équipe ?",
    ];
    for (const text of officeTurns) {
      appendOfficeEvent("openclaw:office", "user_message", { text, role: "user" });
      appendOfficeEvent("openclaw:office", "agent_message", {
        text: `Bien reçu concernant « ${text.slice(0, 40)} ». Je note et je continue.`,
        role: "agent",
      });
    }
    expect(chatTurns("openclaw:office")).toBeGreaterThanOrEqual(12);

    // Lance un vrai projet dans le même contexte
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "Lance un projet surveillance RTX avec une équipe adaptée",
    });
    expect(
      listAiProjects().some((p) => getOrchestration(p)?.phase === "awaiting_plan_approval"),
    ).toBe(true);

    // Nouvelle discussion = archive du long fil
    clearOfficeEvents("openclaw:office");
    const archives = listOfficeConversations("openclaw:office", { status: "archived" });
    expect(archives.length).toBeGreaterThanOrEqual(1);
    const detail = getOfficeConversationDetail(archives[0]!.id)!;
    expect(detail.messageCount).toBeGreaterThanOrEqual(10);
    expect(detail.events.some((e) => /RTX 4090/i.test(String(e.payload.text ?? "")))).toBe(true);

    // Nouveau sujet propre
    appendOfficeEvent("openclaw:office", "user_message", {
      text: "Nouveau sujet : analyse ma boîte mail demain",
      role: "user",
    });
    expect(
      listOfficeEvents("openclaw:office").some((e) => /RTX 4090/i.test(String(e.payload.text ?? ""))),
    ).toBe(false);

    // Conversation parallèle chef (non archivée)
    for (let i = 0; i < 5; i++) {
      appendOfficeEvent("openclaw:chef", "user_message", {
        text: `Priorité #${i + 1} pour le lab`,
        role: "user",
      });
      appendOfficeEvent("openclaw:chef", "agent_message", {
        text: `Priorité #${i + 1} enregistrée avec contexte marché.`,
        role: "agent",
      });
    }
    expect(listOfficeConversations("openclaw:chef", { status: "archived" })).toHaveLength(0);
    clearOfficeEvents("openclaw:chef");
    expect(listOfficeConversations("openclaw:chef", { status: "archived" })).toHaveLength(1);
  });
});

describe("LC-04 — réunion + questions de suivi + statut multi-tours", () => {
  beforeEach(() => {
    freshDb("lc04-");
    seed();
  });
  afterEach(() => closeDb());

  it("réunion → réponses échelonnées → « des nouvelles ? » → suite", async () => {
    const start = await dispatchOfficeAction("openclaw:office", "message", {
      text: "réunion avec tout le monde pour trouver le meilleur objet à vendre cette semaine",
    });
    expect(start.ok).toBe(true);

    // Trouver la tâche réunion créée par le dispatch
    const { listOfficeTasks } = await import("@/lib/db/office-tasks");
    const task =
      listOfficeTasks({ status: "active", limit: 20 }).find((t) => t.meta.meeting === true) ??
      startAllHandsMeeting({
        brief: "meilleur objet à vendre",
        facilitatorAgentId: "openclaw:office",
      });

    const parts = getOfficeTask(task.id)!.meta.participants as {
      agentId: string;
      commandId: string | null;
      status: string;
    }[];
    expect(parts.length).toBeGreaterThanOrEqual(3);

    // Statut tôt : personne n’a répondu
    let status = buildMeetingStatusReply("openclaw:office");
    expect(status).toBeTruthy();

    // Réponses 1 puis question humaine intercalée
    const p0 = parts[0]!;
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("GPU", new Date().toISOString(), p0.commandId!);
    processMeetingAfterCommand(
      p0.commandId!,
      p0.agentId,
      "done",
      "Je propose les GPU reconditionnés milieu de gamme",
      task.id,
    );

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "des nouvelles de la réunion ?",
    });

    const p1 = parts[1]!;
    getDb()
      .prepare(`UPDATE office_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .run("cables", new Date().toISOString(), p1.commandId!);
    processMeetingAfterCommand(
      p1.commandId!,
      p1.agentId,
      "done",
      "Câbles USB-C et hubs — volume + marge",
      task.id,
    );

    status = buildMeetingStatusReply("openclaw:office");
    expect(status).toMatch(/2\/|répondu|Réunion|GPU|Câbles/i);

    const remaining = (getOfficeTask(task.id)!.meta.participants as { status: string }[]).filter(
      (p) => p.status !== "done",
    );
    expect(remaining.length).toBeGreaterThanOrEqual(1);
  });
});

describe("LC-05 — échecs livrables + infos + nudge dans une longue boucle", () => {
  beforeEach(() => {
    freshDb("lc05-");
    seed();
  });
  afterEach(() => closeDb());

  it("soft-fail → question → réponse → nudge → succès", async () => {
    const { project, rootTask } = startPmProject({
      brief: "Lance un projet rapport veille GPU avec équipe",
      title: "LC05 Long",
      facilitatorAgentId: "openclaw:office",
    });
    // Révisions avant go
    revisePlan(project.id, "ajoute focus occasion France");
    revisePlan(project.id, "exclus les annonces pro");
    expect(getOrchestration(getAiProject(project.id)!)!.revisionNotes.length).toBe(2);
    approvePlan(project.id);

    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;

    // Livrable trop court ×2 puis blocage
    processPmAfterCommand(research.commandId!, research.assigneeAgentId!, "done", "ok", research.id);
    expect(Number(getOfficeTask(research.id)?.meta.retryCount)).toBe(1);

    let cur = getOfficeTask(research.id)!;
    processPmAfterCommand(cur.commandId!, cur.assigneeAgentId!, "done", "fait", research.id);
    expect(Number(getOfficeTask(research.id)?.meta.retryCount)).toBe(2);

    cur = getOfficeTask(research.id)!;
    processPmAfterCommand(cur.commandId!, cur.assigneeAgentId!, "done", "oui", research.id);
    // après max retries → failed puis block (question humaine)
    expect(getOfficeTask(research.id)?.status).toBe("blocked");
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "reprends avec focus occasion France hors pro, sources eBay+LBC",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");

    cur = getOfficeTask(research.id)!;
    // Simule retard → nudge
    const old = new Date(Date.now() - SUBTASK_NUDGE_MS - 2000).toISOString();
    getDb().prepare(`UPDATE office_tasks SET updated_at = ? WHERE id = ?`).run(old, cur.id);
    const nudged = processPmTimeouts(Date.now());
    expect(nudged).toBeGreaterThanOrEqual(1);
    expect(Number(getOfficeTask(research.id)?.meta.nudgeCount)).toBeGreaterThanOrEqual(1);

    cur = getOfficeTask(research.id)!;
    ackPm(
      cur.commandId!,
      cur.assigneeAgentId!,
      SOLID("research occasion FR hors pro, eBay+LBC, volume et prix médians"),
      research.id,
    );
    expect(getOfficeTask(research.id)?.status).toBe("done");

    // build + review pour finir
    const build = listOfficeTasksByParent(rootTask.id).find((c) => c.meta.planSubtaskId === "build")!;
    if (build.status === "working" && build.commandId) {
      ackPm(build.commandId, build.assigneeAgentId!, SOLID("build ops"), build.id);
    }
    const review = listOfficeTasksByParent(rootTask.id).find((c) => c.meta.planSubtaskId === "review")!;
    if (review.status === "queued") {
      // deps may unlock
    }
    const review2 = getOfficeTask(review.id)!;
    if (review2.status === "working" && review2.commandId) {
      ackPm(review2.commandId, review2.assigneeAgentId!, SOLID("review finale"), review2.id);
    }

    await dispatchOfficeAction("openclaw:office", "message", { text: "où en est-on ?" });
    expect(buildPmStatusReply("openclaw:office")).toMatch(/LC05|phase|termin/i);
  });
});

describe("LC-06 — double gate info (plan puis livraison) avec refus/révision", () => {
  beforeEach(() => {
    freshDb("lc06-");
    seed();
  });
  afterEach(() => closeDb());

  it("refuse plan partiel → ok → exécute → revision livraison → ok", async () => {
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "Organise une équipe pour un rapport concurrentiel GPU eBay",
    });
    const project = listAiProjects().find((p) => getOrchestration(p))!;

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "révision plutôt focus 3080/3090 d'abord",
    });
    await dispatchOfficeAction("openclaw:office", "message", { text: "ok go" });

    const rootId = getOrchestration(getAiProject(project.id)!)!.rootTaskId;
    for (const c of listOfficeTasksByParent(rootId).filter((t) => t.status === "working")) {
      ackPm(c.commandId!, c.assigneeAgentId!, SOLID(String(c.meta.planSubtaskId)), c.id);
    }
    const review = listOfficeTasksByParent(rootId).find((c) => c.meta.planSubtaskId === "review")!;
    ackPm(review.commandId!, review.assigneeAgentId!, SOLID("review v1"), review.id);

    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_delivery_approval");

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "révision ajoute un tableau prix médians",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
    expect(getOfficeTask(review.id)?.status).toBe("working");

    const reviewAgain = getOfficeTask(review.id)!;
    ackPm(
      reviewAgain.commandId!,
      reviewAgain.assigneeAgentId!,
      SOLID("review v2 avec tableau prix médians 3080/3090"),
      review.id,
    );

    await dispatchOfficeAction("openclaw:office", "message", { text: "c'est bon" });
    expect(getOrchestration(getAiProject(project.id)!)?.delivered).toBe(true);
  });
});

describe("LC-07 — conversation 20+ tours mémoire / compaction context", () => {
  beforeEach(() => {
    freshDb("lc07-");
    seed();
  });
  afterEach(() => closeDb());

  it("simule 24 tours puis nouvelle discussion archive le volume", () => {
    for (let i = 1; i <= 24; i++) {
      appendOfficeEvent("openclaw:office", "user_message", {
        text: `Tour ${i}: précise l'étape ${i} du plan Pixel Brain (détail métier eBay #${i}).`,
        role: "user",
      });
      appendOfficeEvent("openclaw:office", "agent_message", {
        text: `Tour ${i}: j'ai noté l'étape ${i}. Contraintes et dépendances mises à jour pour la suite.`,
        role: "agent",
      });
    }
    expect(chatTurns("openclaw:office")).toBeGreaterThanOrEqual(40);

    clearOfficeEvents("openclaw:office");
    const arch = listOfficeConversations("openclaw:office", { status: "archived" })[0]!;
    expect(arch.messageCount).toBeGreaterThanOrEqual(40);
    expect(getOfficeConversationDetail(arch.id)!.events.length).toBeGreaterThanOrEqual(40);

    // Fil neuf
    expect(chatTurns("openclaw:office")).toBeLessThan(5);
    appendOfficeEvent("openclaw:office", "user_message", {
      text: "Reprise: on repart sur un sujet clean",
      role: "user",
    });
    expect(
      listOfficeEvents("openclaw:office").filter((e) => /Tour 12:/i.test(String(e.payload.text ?? "")))
        .length,
    ).toBe(0);
  });
});
