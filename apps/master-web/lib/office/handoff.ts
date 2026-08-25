import { getAgentTeam, resolveHandoffChain } from "@/lib/db/agent-teams";
import {
  appendTaskEvent,
  createOfficeTask,
  getOfficeTask,
  getOfficeTaskByCommandId,
  updateOfficeTask,
  type OfficeTask,
  type OfficeTaskPhase,
} from "@/lib/db/office-tasks";
import { appendOfficeEvent, enqueueOfficeCommand } from "@/lib/db/office";
import { getAgentProfile } from "@/lib/db/agent-profiles";

const MISSION_RE =
  /\b(mission|projet|délègue|delegue|organise|planifie|équipe|equipe|réunion|reunion|handoff|spawn|multi.?agent|rapport)\b/i;

export function looksLikeMission(text: string): boolean {
  return MISSION_RE.test(text) || text.length > 220;
}

export function nextPhaseAfter(phase: OfficeTaskPhase): OfficeTaskPhase {
  switch (phase) {
    case "meeting":
      return "plan";
    case "plan":
      return "decision";
    case "decision":
      return "execution";
    case "execution":
      return "done";
    default:
      return phase;
  }
}

export function phaseForStatus(
  status: string,
  current: OfficeTaskPhase,
): OfficeTaskPhase {
  if (status === "thinking" && (current === "meeting" || current === "plan")) return current;
  if (status === "working") {
    if (current === "meeting") return "plan";
    if (current === "plan") return "decision";
    if (current === "decision") return "execution";
    return current === "done" || current === "failed" ? current : "execution";
  }
  if (status === "handoff") return current === "execution" ? "decision" : current;
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  return current;
}

/** Prochain destinataire dans la chaîne stockée en meta.handoffChain */
export function peekNextHandoff(task: OfficeTask): string | null {
  const chain = Array.isArray(task.meta.handoffChain)
    ? (task.meta.handoffChain as string[])
    : [];
  const idx = typeof task.meta.handoffIndex === "number" ? task.meta.handoffIndex : 0;
  if (idx >= chain.length) return null;
  return chain[idx] ?? null;
}

export function advanceHandoffIndex(task: OfficeTask): number {
  const idx = typeof task.meta.handoffIndex === "number" ? task.meta.handoffIndex : 0;
  return idx + 1;
}

/**
 * Après ack commande : maj tâche + éventuellement enqueue handoff vers mgr/lead/user.
 * Idempotent si meta.delivered === true.
 */
export function processTaskAfterCommand(
  commandId: string,
  agentId: string,
  status: "done" | "failed",
  resultText: string,
  payloadTaskId?: string | null,
): OfficeTask | null {
  const task =
    (payloadTaskId ? getOfficeTask(payloadTaskId) : null) ?? getOfficeTaskByCommandId(commandId);

  if (!task) {
    return null;
  }

  if (task.meta.meeting === true) {
    return null;
  }

  // Sous-tâches PM : gérées par processPmAfterCommand (DAG)
  if (task.meta.planSubtaskId || task.meta.orchestrationRoot === true) {
    return null;
  }

  if (task.meta.delivered === true) {
    return task;
  }

  if (status === "failed") {
    return updateOfficeTask(
      task.id,
      {
        status: "failed",
        phase: "failed",
        resultSummary: resultText.slice(0, 2000),
      },
      { kind: "status", fromAgent: agentId, text: `Échec: ${resultText.slice(0, 200)}` },
    );
  }

  const next = peekNextHandoff(task);
  if (!next || next === "user") {
    const updated = updateOfficeTask(
      task.id,
      {
        status: "done",
        phase: "done",
        resultSummary: resultText.slice(0, 2000),
        deliverTo: "user",
        meta: { ...task.meta, delivered: true, handoffIndex: advanceHandoffIndex(task) },
      },
      {
        kind: "note",
        fromAgent: agentId,
        toAgent: "user",
        text: `Livraison user: ${resultText.slice(0, 400)}`,
      },
    );
    appendOfficeEvent(agentId, "system", {
      text: `← Livraison tâche « ${task.title} »`,
      role: "system",
      taskId: task.id,
      handoff: true,
    });
    return updated;
  }

  // Handoff vers un autre agent
  const reviewText = [
    `[Handoff tâche ${task.id.slice(0, 8)}]`,
    `Titre: ${task.title}`,
    task.brief ? `Brief: ${task.brief.slice(0, 500)}` : "",
    `Résultat de ${agentId}:`,
    resultText.slice(0, 1500),
    "",
    "Fais une synthèse / validation courte, puis livre au suivant de la chaîne.",
  ]
    .filter(Boolean)
    .join("\n");

  const newIndex = advanceHandoffIndex(task);
  const persona = getAgentProfile(next)?.persona;
  const cmd = enqueueOfficeCommand(next, "message", {
    text: reviewText,
    taskId: task.id,
    handoff: true,
    fromAgent: agentId,
    ...(persona ? { personaHint: persona.slice(0, 400) } : {}),
  });

  appendOfficeEvent(next, "user_message", {
    text: reviewText.slice(0, 800),
    role: "system",
    taskId: task.id,
    handoff: true,
    commandId: cmd.id,
  });
  appendOfficeEvent(agentId, "system", {
    text: `→ Handoff vers ${next}`,
    role: "system",
    taskId: task.id,
    handoff: true,
  });

  return updateOfficeTask(
    task.id,
    {
      status: "handoff",
      phase: phaseForStatus("handoff", task.phase),
      assigneeAgentId: next,
      reporterAgentId: agentId,
      commandId: cmd.id,
      resultSummary: resultText.slice(0, 2000),
      deliverTo: peekNextAfter(task, newIndex) ?? "user",
      meta: { ...task.meta, handoffIndex: newIndex, lastHandoffFrom: agentId },
    },
    {
      kind: "handoff",
      fromAgent: agentId,
      toAgent: next,
      text: `Handoff → ${next}`,
    },
  );
}

function peekNextAfter(task: OfficeTask, index: number): string | null {
  const chain = Array.isArray(task.meta.handoffChain)
    ? (task.meta.handoffChain as string[])
    : [];
  return chain[index] ?? null;
}

export function attachTaskToCommand(taskId: string, commandId: string): void {
  updateOfficeTask(taskId, { commandId, status: "thinking" }, {
    kind: "status",
    text: `Commande ${commandId.slice(0, 8)} liée`,
  });
}

export function createMissionTask(opts: {
  title: string;
  brief: string;
  assigneeAgentId: string;
  commandId: string;
  projectId?: string | null;
  teamId?: string | null;
  multiAgent?: boolean;
}): OfficeTask {
  const team = opts.teamId ? getAgentTeam(opts.teamId) : null;
  const chain = resolveHandoffChain(opts.teamId, opts.assigneeAgentId);
  const phase: OfficeTaskPhase = opts.multiAgent || (team && team.members.length > 1) ? "meeting" : "execution";
  const task = createOfficeTask({
    title: opts.title,
    brief: opts.brief,
    projectId: opts.projectId ?? null,
    teamId: opts.teamId ?? null,
    status: "thinking",
    phase,
    assigneeAgentId: opts.assigneeAgentId,
    reporterAgentId: "user",
    deliverTo: chain[0] ?? "user",
    commandId: opts.commandId,
    meta: {
      handoffChain: chain,
      handoffIndex: 0,
      multiAgent: Boolean(opts.multiAgent || (team && team.members.length > 1)),
    },
  });
  appendTaskEvent({
    taskId: task.id,
    kind: "note",
    fromAgent: "user",
    toAgent: opts.assigneeAgentId,
    text: `Mission ouverte · chaîne ${chain.join(" → ")}`,
  });
  return task;
}

export function applyRuntimeStatusFromEvent(
  commandId: string | null | undefined,
  kind: string,
  payload: Record<string, unknown>,
): OfficeTask | null {
  if (!commandId) return null;
  const task = getOfficeTaskByCommandId(String(commandId));
  if (!task) return null;
  if (task.status === "done" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }

  if (kind === "reflection" || payload.reflection === true) {
    return updateOfficeTask(
      task.id,
      { status: "thinking", phase: phaseForStatus("thinking", task.phase) },
      { kind: "reflection", text: String(payload.text ?? "réflexion").slice(0, 400) },
    );
  }
  if (kind === "progress" || payload.interim === true || kind === "spawn_tree") {
    const phase =
      kind === "spawn_tree"
        ? ("execution" as const)
        : phaseForStatus("working", task.phase);
    return updateOfficeTask(
      task.id,
      { status: "working", phase },
      {
        kind: kind === "spawn_tree" ? "note" : "status",
        text: String(payload.text ?? kind).slice(0, 400),
      },
    );
  }
  return task;
}
