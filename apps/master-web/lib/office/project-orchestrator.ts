/**
 * Orchestrateur PM déterministe — le LLM ne rédige pas l’état.
 * État dans ai_projects.meta.orchestration + office_tasks (arbre parentTaskId).
 */
import {
  createAiProject,
  getAiProject,
  listAiProjects,
  updateAiProject,
  type AiProject,
} from "@/lib/db/ai-projects";
import { createAgentTeam, getAgentTeam } from "@/lib/db/agent-teams";
import {
  appendOfficeEvent,
  cancelQueuedOfficeCommands,
  enqueueOfficeCommand,
  getOfficeCommand,
} from "@/lib/db/office";
import {
  createOfficeTask,
  getOfficeTask,
  listOfficeTasks,
  listOfficeTasksByParent,
  updateOfficeTask,
  type OfficeTask,
} from "@/lib/db/office-tasks";
import {
  buildDeterministicPlanFromBrief,
  formatPlanSummaryForHuman,
  type ProjectPlan,
} from "@/lib/office/project-plan";

export type OrchestrationPhase =
  | "planning"
  | "awaiting_plan_approval"
  | "executing"
  | "awaiting_human"
  | "awaiting_delivery_approval"
  | "delivering"
  | "delivered"
  | "cancelled"
  | "failed";

export type OrchestrationState = {
  version: 1;
  phase: OrchestrationPhase;
  rootTaskId: string;
  projectId: string;
  planDraft: ProjectPlan | null;
  planApproved: boolean;
  teamId: string | null;
  subtaskMap: Record<string, string>;
  pendingGate: {
    type: string;
    prompt: string;
    afterSubtaskIds: string[];
  } | null;
  blockedQuestion: {
    taskId: string;
    text: string;
    toAgentId?: string;
  } | null;
  processedCommands: string[];
  delivered: boolean;
  revisionNotes: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectRollup = {
  projectId: string;
  title: string;
  phase: OrchestrationPhase | string;
  total: number;
  done: number;
  blocked: number;
  working: number;
  failed: number;
  percent: number;
  rootTaskId: string | null;
};

export const SUBTASK_TIMEOUT_MS = 30 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

export function getOrchestration(project: AiProject): OrchestrationState | null {
  const raw = project.meta?.orchestration;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as OrchestrationState;
  if (o.version !== 1 || !o.rootTaskId || !o.projectId) return null;
  return {
    ...o,
    subtaskMap: o.subtaskMap ?? {},
    processedCommands: Array.isArray(o.processedCommands) ? o.processedCommands : [],
    revisionNotes: Array.isArray(o.revisionNotes) ? o.revisionNotes : [],
    planDraft: o.planDraft ?? null,
    pendingGate: o.pendingGate ?? null,
    blockedQuestion: o.blockedQuestion ?? null,
  };
}

export function setOrchestration(projectId: string, state: OrchestrationState): AiProject | null {
  const updated: OrchestrationState = { ...state, updatedAt: nowIso() };
  return updateAiProject(projectId, {
    meta: { orchestration: updated },
  });
}

export function listChildTasks(parentTaskId: string): OfficeTask[] {
  return listOfficeTasksByParent(parentTaskId);
}

export function getActivePmProjects(): AiProject[] {
  return listAiProjects("all").filter((p) => {
    const orch = getOrchestration(p);
    if (!orch) return false;
    return ![
      "delivered",
      "cancelled",
      "failed",
    ].includes(orch.phase);
  });
}

export function getActivePmProject(): AiProject | null {
  const all = getActivePmProjects();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function findProjectAwaitingPlanApproval(): AiProject | null {
  return (
    getActivePmProjects().find((p) => getOrchestration(p)?.phase === "awaiting_plan_approval") ??
    null
  );
}

export function findProjectAwaitingHuman(): AiProject | null {
  return (
    getActivePmProjects().find((p) => {
      const ph = getOrchestration(p)?.phase;
      return ph === "awaiting_human" || ph === "awaiting_delivery_approval";
    }) ?? null
  );
}

export function rollupProjectProgress(projectId: string): ProjectRollup | null {
  const project = getAiProject(projectId);
  if (!project) return null;
  const orch = getOrchestration(project);
  const children = orch
    ? listChildTasks(orch.rootTaskId)
    : listOfficeTasks({ projectId, limit: 100 }).filter((t) => t.parentTaskId);
  const total = children.length;
  const done = children.filter((t) => t.status === "done").length;
  const blocked = children.filter((t) => t.status === "blocked").length;
  const failed = children.filter((t) => t.status === "failed" || t.status === "cancelled").length;
  const working = children.filter((t) =>
    ["working", "thinking", "handoff"].includes(t.status),
  ).length;
  const phase = orch?.phase ?? "unknown";
  const percent =
    phase === "delivered"
      ? 100
      : total > 0
        ? Math.round((done / total) * 100)
        : phase === "awaiting_plan_approval"
          ? 5
          : 0;
  return {
    projectId,
    title: project.title,
    phase,
    total,
    done,
    blocked,
    working,
    failed,
    percent,
    rootTaskId: orch?.rootTaskId ?? null,
  };
}

export function buildPmStatusReply(facilitatorAgentId?: string): string | null {
  const project = getActivePmProject();
  if (!project) return null;
  const orch = getOrchestration(project);
  const rollup = rollupProjectProgress(project.id);
  if (!rollup || !orch) return null;
  void facilitatorAgentId;
  const lines = [
    `Projet « ${rollup.title} » · phase ${rollup.phase}`,
    `${rollup.done}/${rollup.total || "—"} sous-tâches terminées (${rollup.percent}%)`,
  ];
  if (rollup.working) lines.push(`${rollup.working} en cours`);
  if (rollup.blocked) lines.push(`${rollup.blocked} bloquée(s)`);
  if (orch.blockedQuestion) {
    lines.push(`Question en attente: ${orch.blockedQuestion.text}`);
  }
  if (orch.pendingGate) {
    lines.push(`Gate: ${orch.pendingGate.prompt}`);
  }
  if (orch.phase === "awaiting_plan_approval") {
    lines.push("En attente de validation du plan (réponds « ok go »).");
  }
  const children = listChildTasks(orch.rootTaskId);
  for (const c of children.slice(0, 8)) {
    lines.push(
      `· ${c.title}: ${c.status}${c.assigneeAgentId ? ` @${c.assigneeAgentId.replace(/^openclaw:/, "")}` : ""}`,
    );
  }
  return lines.join("\n");
}

export function startPmProject(opts: {
  brief: string;
  title?: string;
  facilitatorAgentId: string;
}): {
  project: AiProject;
  rootTask: OfficeTask;
  plan: ProjectPlan;
  reply: string;
} {
  const plan = buildDeterministicPlanFromBrief(opts.brief, opts.title);
  const createdAt = nowIso();
  const project = createAiProject({
    title: plan.title,
    kind: "punctual",
    status: "active",
    brief: plan.brief,
    goals: plan.acceptanceCriteria.join(" · "),
    agentId: opts.facilitatorAgentId,
    meta: {},
  });

  const rootTask = createOfficeTask({
    title: `PM · ${plan.title}`,
    brief: plan.brief,
    projectId: project.id,
    status: "blocked",
    phase: "plan",
    assigneeAgentId: opts.facilitatorAgentId,
    reporterAgentId: "user",
    deliverTo: "user",
    meta: {
      orchestrationRoot: true,
      awaitingHumanGate: "plan",
    },
  });

  const state: OrchestrationState = {
    version: 1,
    phase: "awaiting_plan_approval",
    rootTaskId: rootTask.id,
    projectId: project.id,
    planDraft: plan,
    planApproved: false,
    teamId: null,
    subtaskMap: {},
    pendingGate: null,
    blockedQuestion: null,
    processedCommands: [],
    delivered: false,
    revisionNotes: [],
    createdAt,
    updatedAt: createdAt,
  };
  setOrchestration(project.id, state);

  const reply = [
    `Projet « ${plan.title} » ouvert — je prépare l’équipe.`,
    "",
    formatPlanSummaryForHuman(plan),
  ].join("\n");

  appendOfficeEvent(opts.facilitatorAgentId, "user_message", {
    text: opts.brief,
    role: "user",
    projectId: project.id,
    taskId: rootTask.id,
  });
  appendOfficeEvent(opts.facilitatorAgentId, "agent_message", {
    text: reply,
    role: "agent",
    projectId: project.id,
    taskId: rootTask.id,
    pmOrchestration: true,
  });

  return {
    project: getAiProject(project.id)!,
    rootTask: getOfficeTask(rootTask.id)!,
    plan,
    reply,
  };
}

export function materializeTeam(plan: ProjectPlan, projectId: string) {
  const lead =
    plan.teamProposal.find((m) => m.role === "lead")?.agentId ?? "openclaw:chef";
  const team = createAgentTeam({
    name: `PM · ${plan.title}`.slice(0, 120),
    leadAgentId: lead,
    notes: `Équipe auto pour projet ${projectId.slice(0, 8)}`,
    members: plan.teamProposal.map((m, i) => ({
      agentId: m.agentId,
      roleInTeam: m.role,
      sortOrder: i,
    })),
  });
  updateAiProject(projectId, { teamId: team.id });
  return team;
}

export function spawnSubtasks(
  rootTaskId: string,
  projectId: string,
  plan: ProjectPlan,
  teamId: string | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of plan.subtasks) {
    const task = createOfficeTask({
      title: s.title,
      brief: `${s.acceptance}\n\nContexte: ${plan.brief.slice(0, 800)}`,
      projectId,
      teamId,
      parentTaskId: rootTaskId,
      status: "queued",
      phase: "execution",
      assigneeAgentId: s.assigneeAgentId,
      reporterAgentId: "openclaw:office",
      deliverTo: "openclaw:chef",
      meta: {
        planSubtaskId: s.id,
        dependsOn: s.dependsOn,
        kind: s.kind,
        acceptance: s.acceptance,
        retryCount: 0,
      },
    });
    map[s.id] = task.id;
  }
  return map;
}

function depsSatisfied(task: OfficeTask, children: OfficeTask[]): boolean {
  const deps = Array.isArray(task.meta.dependsOn) ? (task.meta.dependsOn as string[]) : [];
  if (deps.length === 0) return true;
  for (const depId of deps) {
    const dep = children.find((c) => c.meta.planSubtaskId === depId);
    if (!dep || dep.status !== "done") return false;
  }
  return true;
}

function enqueueSubtaskWork(task: OfficeTask, project: AiProject, plan: ProjectPlan): OfficeTask {
  const planSubId = String(task.meta.planSubtaskId ?? "");
  const text = [
    `[Sous-tâche PM · ${plan.title} · ${planSubId}]`,
    task.title,
    "",
    task.brief.slice(0, 1200),
    "",
    "Livre un résultat concret et concis. Ne spawn pas d’autres agents.",
  ].join("\n");

  const cmd = enqueueOfficeCommand(task.assigneeAgentId || "openclaw:chef", "message", {
    text,
    taskId: task.id,
    projectId: project.id,
    teamId: project.teamId,
    forceOpenClaw: true,
    pmSubtask: true,
    planSubtaskId: planSubId,
  });

  return (
    updateOfficeTask(
      task.id,
      {
        status: "working",
        phase: "execution",
        commandId: cmd.id,
      },
      { kind: "status", text: `Commande ${cmd.id.slice(0, 8)} lancée` },
    ) ?? task
  );
}

export function tickOrchestration(projectId: string): {
  launched: string[];
  delivered: boolean;
  awaitingGate: boolean;
} {
  const project = getAiProject(projectId);
  if (!project) return { launched: [], delivered: false, awaitingGate: false };
  const orch = getOrchestration(project);
  if (!orch?.planDraft) return { launched: [], delivered: false, awaitingGate: false };
  if (orch.delivered || orch.phase === "cancelled" || orch.phase === "failed") {
    return { launched: [], delivered: orch.delivered, awaitingGate: false };
  }
  if (
    orch.phase === "awaiting_plan_approval" ||
    orch.phase === "awaiting_human" ||
    orch.phase === "awaiting_delivery_approval"
  ) {
    return { launched: [], delivered: false, awaitingGate: true };
  }

  const plan = orch.planDraft;
  const children = listChildTasks(orch.rootTaskId);
  const launched: string[] = [];

  for (const child of children) {
    if (child.status !== "queued") continue;
    if (!depsSatisfied(child, children)) continue;
    enqueueSubtaskWork(child, project, plan);
    launched.push(child.id);
  }

  const fresh = listChildTasks(orch.rootTaskId);
  const allDone =
    fresh.length > 0 &&
    fresh.every((c) => c.status === "done" || c.status === "cancelled" || c.status === "failed");
  const anyFailed = fresh.some((c) => c.status === "failed");

  if (allDone && !anyFailed) {
    const gate = plan.gates.find((g) =>
      g.afterSubtaskIds.every((id) => {
        const t = fresh.find((c) => c.meta.planSubtaskId === id);
        return t?.status === "done";
      }),
    );
    if (gate) {
      const next: OrchestrationState = {
        ...orch,
        phase: "awaiting_delivery_approval",
        pendingGate: {
          type: gate.type,
          prompt: gate.prompt,
          afterSubtaskIds: gate.afterSubtaskIds,
        },
      };
      setOrchestration(projectId, next);
      updateOfficeTask(
        orch.rootTaskId,
        { status: "blocked", meta: { awaitingHumanGate: "delivery" } },
        { kind: "status", text: gate.prompt },
      );
      const facilitator = project.agentId || "openclaw:office";
      appendOfficeEvent(facilitator, "agent_message", {
        text: `Sous-tâches terminées.\n${gate.prompt}\nRéponds « ok go » pour livrer, ou « révision ».`,
        role: "agent",
        projectId,
        pmOrchestration: true,
      });
      return { launched, delivered: false, awaitingGate: true };
    }
    deliverProject(projectId);
    return { launched, delivered: true, awaitingGate: false };
  }

  if (orch.phase !== "executing" && launched.length > 0) {
    setOrchestration(projectId, { ...orch, phase: "executing" });
  }

  return { launched, delivered: false, awaitingGate: false };
}

export function approvePlan(projectId: string): {
  ok: boolean;
  teamId: string | null;
  childCount: number;
  reply: string;
} {
  const project = getAiProject(projectId);
  if (!project) return { ok: false, teamId: null, childCount: 0, reply: "Projet introuvable" };
  const orch = getOrchestration(project);
  if (!orch?.planDraft) return { ok: false, teamId: null, childCount: 0, reply: "Pas de plan" };
  if (orch.planApproved && Object.keys(orch.subtaskMap).length > 0) {
    tickOrchestration(projectId);
    return {
      ok: true,
      teamId: orch.teamId,
      childCount: Object.keys(orch.subtaskMap).length,
      reply: "Plan déjà approuvé — reprise de l’exécution.",
    };
  }

  const plan = orch.planDraft;
  const team = materializeTeam(plan, projectId);
  const map = spawnSubtasks(orch.rootTaskId, projectId, plan, team.id);

  setOrchestration(projectId, {
    ...orch,
    phase: "executing",
    planApproved: true,
    teamId: team.id,
    subtaskMap: map,
    pendingGate: null,
  });

  updateOfficeTask(
    orch.rootTaskId,
    {
      status: "working",
      phase: "execution",
      meta: { awaitingHumanGate: null, orchestrationRoot: true },
    },
    { kind: "status", text: "Plan approuvé — exécution" },
  );

  const tick = tickOrchestration(projectId);
  const reply = [
    `Plan approuvé. Équipe « ${team.name} » (${team.members.length} agents).`,
    `${Object.keys(map).length} sous-tâches créées · ${tick.launched.length} lancée(s) en parallèle.`,
  ].join("\n");

  const facilitator = project.agentId || "openclaw:office";
  appendOfficeEvent(facilitator, "agent_message", {
    text: reply,
    role: "agent",
    projectId,
    pmOrchestration: true,
  });

  return { ok: true, teamId: team.id, childCount: Object.keys(map).length, reply };
}

export function rejectPlan(projectId: string, reason?: string): { ok: boolean; reply: string } {
  const r = cancelPmProject({ projectId, reason: reason || "plan rejeté" });
  return { ok: r.ok, reply: r.reply };
}

export function revisePlan(
  projectId: string,
  note: string,
): { ok: boolean; reply: string } {
  const project = getAiProject(projectId);
  if (!project) return { ok: false, reply: "Projet introuvable" };
  const orch = getOrchestration(project);
  if (!orch?.planDraft) return { ok: false, reply: "Pas de plan" };

  const notes = [...orch.revisionNotes, note.trim().slice(0, 500)].filter(Boolean);
  setOrchestration(projectId, {
    ...orch,
    phase: "awaiting_plan_approval",
    revisionNotes: notes,
  });
  updateOfficeTask(
    orch.rootTaskId,
    { status: "blocked", phase: "plan", meta: { awaitingHumanGate: "plan" } },
    { kind: "note", text: `Révision demandée: ${note.slice(0, 200)}` },
  );

  const reply = [
    "Plan en révision. Note prise :",
    note.slice(0, 300),
    "",
    formatPlanSummaryForHuman(orch.planDraft),
    notes.length ? `\nNotes cumulées: ${notes.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  appendOfficeEvent(project.agentId || "openclaw:office", "agent_message", {
    text: reply,
    role: "agent",
    projectId,
    pmOrchestration: true,
  });
  return { ok: true, reply };
}

export function deliverProject(projectId: string): { ok: boolean; reply: string } {
  const project = getAiProject(projectId);
  if (!project) return { ok: false, reply: "introuvable" };
  const orch = getOrchestration(project);
  if (!orch) return { ok: false, reply: "pas d’orchestration" };
  if (orch.delivered) {
    return { ok: true, reply: "Déjà livré." };
  }

  const children = listChildTasks(orch.rootTaskId);
  const synthesis = [
    `Livraison projet « ${project.title} »`,
    "",
    ...children.map(
      (c) =>
        `· ${c.title}: ${(c.resultSummary || c.status).slice(0, 280)}`,
    ),
    "",
    `Critères: ${(orch.planDraft?.acceptanceCriteria ?? []).join(" · ")}`,
  ].join("\n");

  updateOfficeTask(
    orch.rootTaskId,
    {
      status: "done",
      phase: "done",
      resultSummary: synthesis.slice(0, 2000),
      meta: { delivered: true, awaitingHumanGate: null },
    },
    { kind: "status", text: "Projet livré" },
  );

  setOrchestration(projectId, {
    ...orch,
    phase: "delivered",
    delivered: true,
    pendingGate: null,
    blockedQuestion: null,
  });
  updateAiProject(projectId, { status: "done" });

  const facilitator = project.agentId || "openclaw:office";
  appendOfficeEvent(facilitator, "agent_message", {
    text: synthesis,
    role: "agent",
    projectId,
    kind: "project.delivered",
    pmOrchestration: true,
  });

  return { ok: true, reply: synthesis };
}

export function cancelPmProject(opts: {
  projectId?: string;
  titleQuery?: string;
  reason?: string;
}): { ok: boolean; reply: string; projectId?: string } {
  let project: AiProject | null = null;
  if (opts.projectId) project = getAiProject(opts.projectId);
  if (!project && opts.titleQuery) {
    const q = opts.titleQuery.toLowerCase();
    project =
      listAiProjects("all").find((p) => {
        if (!getOrchestration(p)) return false;
        return p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase().slice(0, 12));
      }) ?? null;
  }
  if (!project) {
    project = getActivePmProject();
  }
  if (!project) return { ok: false, reply: "Aucun projet PM à annuler" };
  const orch = getOrchestration(project);
  if (!orch) return { ok: false, reply: "Pas d’orchestration sur ce projet" };
  if (orch.phase === "cancelled") {
    return { ok: true, reply: "Déjà annulé", projectId: project.id };
  }

  const children = listChildTasks(orch.rootTaskId);
  for (const c of children) {
    if (c.status === "done" || c.status === "cancelled") continue;
    if (c.assigneeAgentId) cancelQueuedOfficeCommands(c.assigneeAgentId);
    updateOfficeTask(
      c.id,
      { status: "cancelled", phase: "failed" },
      { kind: "status", text: opts.reason || "annulé" },
    );
  }
  updateOfficeTask(
    orch.rootTaskId,
    { status: "cancelled", phase: "failed" },
    { kind: "status", text: opts.reason || "projet annulé" },
  );
  setOrchestration(project.id, {
    ...orch,
    phase: "cancelled",
    pendingGate: null,
    blockedQuestion: null,
  });
  updateAiProject(project.id, { status: "paused" });

  const reply = `Projet « ${project.title} » annulé (${children.length} sous-tâches).`;
  appendOfficeEvent(project.agentId || "openclaw:office", "agent_message", {
    text: reply,
    role: "agent",
    projectId: project.id,
    pmOrchestration: true,
  });
  return { ok: true, reply, projectId: project.id };
}

export function blockSubtaskWithQuestion(
  taskId: string,
  question: string,
  opts?: { toAgentId?: string },
): OfficeTask | null {
  const task = getOfficeTask(taskId);
  if (!task?.projectId) return null;
  const project = getAiProject(task.projectId);
  if (!project) return null;
  const orch = getOrchestration(project);
  if (!orch) return null;

  const updated = updateOfficeTask(
    taskId,
    {
      status: "blocked",
      meta: {
        blockedQuestion: {
          toAgentId: opts?.toAgentId,
          text: question,
          awaitingHuman: true,
        },
      },
    },
    { kind: "agent_question", text: question },
  );

  setOrchestration(project.id, {
    ...orch,
    phase: "awaiting_human",
    blockedQuestion: {
      taskId,
      text: question,
      toAgentId: opts?.toAgentId,
    },
  });

  appendOfficeEvent(project.agentId || "openclaw:office", "agent_message", {
    text: `Blocage sur « ${task.title} »:\n${question}\nRéponds pour débloquer.`,
    role: "agent",
    projectId: project.id,
    taskId,
    pmOrchestration: true,
  });

  return updated;
}

export function answerBlockedQuestion(
  projectId: string,
  humanText: string,
): { ok: boolean; reply: string } {
  const project = getAiProject(projectId);
  if (!project) return { ok: false, reply: "introuvable" };
  const orch = getOrchestration(project);
  if (!orch) return { ok: false, reply: "pas d’orchestration" };

  // Gate livraison
  if (orch.phase === "awaiting_delivery_approval") {
    const gate = parseLooseGate(humanText);
    if (gate === "approve") {
      const d = deliverProject(projectId);
      return { ok: d.ok, reply: d.reply };
    }
    if (gate === "revise") {
      setOrchestration(projectId, {
        ...orch,
        phase: "executing",
        pendingGate: null,
        revisionNotes: [...orch.revisionNotes, humanText.slice(0, 400)],
      });
      return { ok: true, reply: "Livraison en révision — précise ce qu’il manque." };
    }
  }

  if (!orch.blockedQuestion) {
    return { ok: false, reply: "Aucune question bloquante en attente" };
  }

  const task = getOfficeTask(orch.blockedQuestion.taskId);
  if (!task) return { ok: false, reply: "Tâche bloquée introuvable" };

  updateOfficeTask(
    task.id,
    {
      status: "queued",
      meta: {
        blockedQuestion: null,
        humanAnswer: humanText.slice(0, 1000),
      },
    },
    { kind: "human_answer", text: humanText.slice(0, 400) },
  );

  setOrchestration(projectId, {
    ...orch,
    phase: "executing",
    blockedQuestion: null,
  });

  tickOrchestration(projectId);
  const reply = `Réponse prise en compte. Reprise de « ${task.title} ».`;
  appendOfficeEvent(project.agentId || "openclaw:office", "agent_message", {
    text: reply,
    role: "agent",
    projectId,
    pmOrchestration: true,
  });
  return { ok: true, reply };
}

function parseLooseGate(text: string): "approve" | "revise" | null {
  const t = text.trim();
  if (/^(?:ok(?:\s+go)?|go|oui|approuv|valide|c['']est\s+bon)/i.test(t)) return "approve";
  if (/\b(?:r[eé]vision|revise|ajoute|change)\b/i.test(t)) return "revise";
  return null;
}

export function processPmAfterCommand(
  commandId: string,
  agentId: string,
  status: "done" | "failed",
  resultText: string,
  payloadTaskId?: string | null,
): OfficeTask | null {
  const task =
    (payloadTaskId ? getOfficeTask(payloadTaskId) : null) ??
    (() => {
      const cmd = getOfficeCommand(commandId);
      const tid = cmd && typeof cmd.payload.taskId === "string" ? cmd.payload.taskId : null;
      return tid ? getOfficeTask(tid) : null;
    })();

  if (!task?.projectId || !task.meta.planSubtaskId) return null;
  const project = getAiProject(task.projectId);
  if (!project) return null;
  const orch = getOrchestration(project);
  if (!orch) return null;

  if (orch.processedCommands.includes(commandId)) {
    return getOfficeTask(orch.rootTaskId);
  }

  const processed = [...orch.processedCommands, commandId].slice(-200);

  if (status === "failed") {
    const retries = Number(task.meta.retryCount ?? 0);
    if (retries < 1) {
      updateOfficeTask(
        task.id,
        {
          status: "queued",
          meta: { retryCount: retries + 1, lastError: resultText.slice(0, 500) },
          commandId: null,
        },
        { kind: "status", text: "Retry automatique 1/1" },
      );
      setOrchestration(project.id, { ...orch, processedCommands: processed, phase: "executing" });
      tickOrchestration(project.id);
      return getOfficeTask(orch.rootTaskId);
    }
    updateOfficeTask(
      task.id,
      {
        status: "failed",
        phase: "failed",
        resultSummary: resultText.slice(0, 2000),
      },
      { kind: "status", text: "Échec sous-tâche", fromAgent: agentId },
    );
    blockSubtaskWithQuestion(
      task.id,
      `Échec de « ${task.title} »: ${resultText.slice(0, 200)}. Que faire ?`,
    );
    const fresh = getOrchestration(getAiProject(project.id)!)!;
    setOrchestration(project.id, { ...fresh, processedCommands: processed });
    return getOfficeTask(orch.rootTaskId);
  }

  updateOfficeTask(
    task.id,
    {
      status: "done",
      phase: "done",
      resultSummary: resultText.slice(0, 2000),
    },
    { kind: "status", text: "Sous-tâche terminée", fromAgent: agentId },
  );

  setOrchestration(project.id, {
    ...orch,
    processedCommands: processed,
    phase: orch.phase === "awaiting_human" ? "executing" : orch.phase,
  });
  tickOrchestration(project.id);
  return getOfficeTask(orch.rootTaskId);
}

/** Escalade si sous-tâche working/blocked trop longtemps. */
export function processPmTimeouts(nowMs = Date.now()): number {
  let n = 0;
  for (const project of getActivePmProjects()) {
    const orch = getOrchestration(project);
    if (!orch || orch.phase === "awaiting_plan_approval") continue;
    const children = listChildTasks(orch.rootTaskId);
    for (const c of children) {
      if (c.status !== "working" && c.status !== "blocked" && c.status !== "thinking") continue;
      const age = nowMs - new Date(c.updatedAt).getTime();
      if (age < SUBTASK_TIMEOUT_MS) continue;
      if (c.meta.timeoutEscalated === true) continue;
      updateOfficeTask(
        c.id,
        { meta: { timeoutEscalated: true } },
        { kind: "status", text: "Timeout — escalade humain" },
      );
      blockSubtaskWithQuestion(
        c.id,
        `Timeout (${Math.round(age / 60_000)} min) sur « ${c.title} ». Continuer, annuler ou préciser ?`,
      );
      n += 1;
    }
  }
  return n;
}

/** Approuve la gate livraison si en attente. */
export function approveDeliveryGate(projectId: string): { ok: boolean; reply: string } {
  const project = getAiProject(projectId);
  if (!project) return { ok: false, reply: "introuvable" };
  const orch = getOrchestration(project);
  if (orch?.phase !== "awaiting_delivery_approval") {
    return { ok: false, reply: "Pas de gate livraison" };
  }
  return deliverProject(projectId);
}

export function findPmProjectByIdOrActive(projectId?: string | null): AiProject | null {
  if (projectId) return getAiProject(projectId);
  return getActivePmProject();
}

/** Exposé pour tests / UI */
export function getTeamForProject(projectId: string) {
  const p = getAiProject(projectId);
  return p?.teamId ? getAgentTeam(p.teamId) : null;
}
