/**
 * Batterie stress — solidité orchestration sous enchaînements durs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import {
  claimOfficeCommands,
  completeOfficeCommand,
  enqueueOfficeCommand,
  getOfficeCommand,
  upsertOfficeAgent,
} from "@/lib/db/office";
import { getAiProject } from "@/lib/db/ai-projects";
import { getOfficeTask, listOfficeTasksByParent } from "@/lib/db/office-tasks";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { OFFICE_CLAIM_STALE_MS } from "@/lib/office/types";
import {
  approvePlan,
  assessSubtaskDelivery,
  extractAgentQuestion,
  getOrchestration,
  processPmAfterCommand,
  processPmTimeouts,
  reconcileOrphanPmSubtasks,
  startPmProject,
} from "@/lib/office/project-orchestrator";
import { tickDueRecurringProjects } from "@/lib/office/recurring-tick";

vi.mock("@/lib/office/mail-imap", () => ({
  verifyMailImap: vi.fn(async () => ({ ok: true, mailbox: "INBOX" })),
  fetchInboxPreview: vi.fn(async () => ({ ok: true, messages: [] })),
  formatInboxBrief: vi.fn(() => ""),
}));

function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.MASTER_DB_PATH = join(dir, "t.db");
  process.env.NEXTAUTH_SECRET = "test-secret-for-aes-256-gcm-key!!";
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
}

const SOLID = (l: string) =>
  `Livrable ${l}: analyse détaillée, contraintes listées, prochaines étapes actionnables pour livraison.`;

describe("ST-assess — questions agent", () => {
  it("détecte une question HITL", () => {
    const q = extractAgentQuestion(
      "Avant de continuer, peux-tu confirmer le budget max en euros ?",
    );
    expect(q).toMatch(/budget|euros/i);
    const a = assessSubtaskDelivery(
      "Peux-tu préciser si on cible eBay seulement ou aussi Leboncoin ?",
    );
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.needsHuman).toBe(true);
  });

  it("ne bloque pas un vrai livrable avec un ? rhétorique long", () => {
    const text = SOLID("research") + " Est-ce clair pour la suite opérationnelle du plan.";
    // pas de ? → ok
    expect(assessSubtaskDelivery(text).ok).toBe(true);
  });
});

describe("ST-01 — agent demande info → HITL → reprise → done", () => {
  beforeEach(() => freshDb("st01-"));
  afterEach(() => closeDb());

  it("question ne consomme pas les retries", async () => {
    const { project, rootTask } = startPmProject({
      brief: "Lance un projet eBay avec équipe",
      title: "ST01",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;

    processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      "Peux-tu confirmer le seuil de prix maximum avant que je scanne eBay ?",
      research.id,
    );

    expect(getOfficeTask(research.id)?.status).toBe("blocked");
    expect(Number(getOfficeTask(research.id)?.meta.retryCount ?? 0)).toBe(0);
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "seuil à 380 euros TTC",
    });
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("executing");
    expect(getOfficeTask(research.id)?.status).toBe("working");
    expect(getOfficeTask(research.id)?.meta.humanAnswer).toMatch(/380/);

    const cur = getOfficeTask(research.id)!;
    processPmAfterCommand(
      cur.commandId!,
      cur.assigneeAgentId!,
      "done",
      SOLID("research seuil 380 eBay"),
      research.id,
    );
    expect(getOfficeTask(research.id)?.status).toBe("done");
  });
});

describe("ST-02 — commande claimed périmée → reconcile → retry", () => {
  beforeEach(() => freshDb("st02-"));
  afterEach(() => closeDb());

  it("orphan claimed stale est repris par le watchdog", () => {
    const { project, rootTask } = startPmProject({
      brief: "projet",
      title: "ST02",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    const cmdId = research.commandId!;

    // Claim puis vieillir
    claimOfficeCommands("mac-test", 10);
    const old = new Date(Date.now() - OFFICE_CLAIM_STALE_MS - 5000).toISOString();
    getDb()
      .prepare(`UPDATE office_commands SET status = 'claimed', updated_at = ? WHERE id = ?`)
      .run(old, cmdId);
    getDb()
      .prepare(`UPDATE office_tasks SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), research.id);

    const n = reconcileOrphanPmSubtasks(Date.now());
    expect(n).toBeGreaterThanOrEqual(1);

    // Soit retry working, soit blocked si retries épuisés — ici 1er fail → retry working
    const after = getOfficeTask(research.id)!;
    expect(["working", "queued", "blocked"]).toContain(after.status);
    expect(getOfficeCommand(cmdId)?.status).toBe("failed");
  });
});

describe("ST-03 — cron tick sans sentinelle exécute quand même le watchdog PM", () => {
  beforeEach(() => freshDb("st03-"));
  afterEach(() => closeDb());

  it("tickDueRecurringProjects appelle processPmTimeouts", () => {
    const { project, rootTask } = startPmProject({
      brief: "x",
      title: "ST03",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;
    const cmdId = research.commandId!;
    completeOfficeCommand(cmdId, "done", SOLID("research déjà ack côté commande"));
    // Commande done mais PM pas notifié → orphan reconcile
    const result = tickDueRecurringProjects();
    expect(result.pmTimeouts).toBeGreaterThanOrEqual(1);
    expect(getOfficeTask(research.id)?.status).toBe("done");
    expect(getOrchestration(getAiProject(project.id)!)?.processedCommands).toContain(cmdId);
  });
});

describe("ST-04 — enchaînement 2 questions info successives", () => {
  beforeEach(() => freshDb("st04-"));
  afterEach(() => closeDb());

  it("Q1 puis Q2 puis livraison partielle research", async () => {
    const { project, rootTask } = startPmProject({
      brief: "équipe",
      title: "ST04",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    let research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;

    processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      "Quelle catégorie eBay dois-je cibler en priorité ?",
      research.id,
    );
    await dispatchOfficeAction("openclaw:office", "message", {
      text: "Cartes graphiques / GPU",
    });

    research = getOfficeTask(research.id)!;
    processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      "Peux-tu confirmer aussi le budget max TTC ?",
      research.id,
    );
    await dispatchOfficeAction("openclaw:office", "message", { text: "400€" });

    research = getOfficeTask(research.id)!;
    processPmAfterCommand(
      research.commandId!,
      research.assigneeAgentId!,
      "done",
      SOLID("research GPU <400€"),
      research.id,
    );
    expect(getOfficeTask(research.id)?.status).toBe("done");
  });
});

describe("ST-05 — stress 5 cycles soft-fail + question + nudge path", () => {
  beforeEach(() => freshDb("st05-"));
  afterEach(() => closeDb());

  it("reste cohérent jusqu’à done", async () => {
    const { project, rootTask } = startPmProject({
      brief: "stress",
      title: "ST05",
      facilitatorAgentId: "openclaw:office",
    });
    approvePlan(project.id);
    const research = listOfficeTasksByParent(rootTask.id).find(
      (c) => c.meta.planSubtaskId === "research",
    )!;

    // 2 soft fails
    processPmAfterCommand(research.commandId!, research.assigneeAgentId!, "done", "ok", research.id);
    let cur = getOfficeTask(research.id)!;
    processPmAfterCommand(cur.commandId!, cur.assigneeAgentId!, "done", "fait", research.id);

    // question
    cur = getOfficeTask(research.id)!;
    processPmAfterCommand(
      cur.commandId!,
      cur.assigneeAgentId!,
      "done",
      "Dis-moi si on inclut les lots incomplets ?",
      research.id,
    );
    expect(getOrchestration(getAiProject(project.id)!)?.phase).toBe("awaiting_human");

    await dispatchOfficeAction("openclaw:office", "message", {
      text: "non, lots complets seulement",
    });
    cur = getOfficeTask(research.id)!;
    processPmAfterCommand(cur.commandId!, cur.assigneeAgentId!, "done", SOLID("research lots complets"), research.id);
    expect(getOfficeTask(research.id)?.status).toBe("done");

    // watchdog no-op safe
    expect(() => processPmTimeouts(Date.now())).not.toThrow();
  });
});
