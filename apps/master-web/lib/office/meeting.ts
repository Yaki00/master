import {
  appendTaskEvent,
  createOfficeTask,
  getOfficeTask,
  listOfficeTasks,
  updateOfficeTask,
  type OfficeTask,
} from "@/lib/db/office-tasks";
import { appendOfficeEvent, enqueueOfficeCommand, getAggregatedOfficeAgent, upsertOfficeAgent } from "@/lib/db/office";
import { appendAgentLog } from "@/lib/db/agent-logs";
import { displayName } from "@/lib/office/labels";
import type { OfficeAgent } from "@/lib/office/types";

export { parseMeetingIntent, parseMeetingStatusQuery } from "@/lib/office/meeting-intent";

export type MeetingParticipant = {
  agentId: string;
  commandId: string | null;
  status: "pending" | "working" | "done" | "failed";
  response: string | null;
};

export type MeetingMeta = {
  meeting: true;
  facilitatorAgentId: string;
  participants: MeetingParticipant[];
  synthesisCommandId: string | null;
  synthesisDone: boolean;
  brief: string;
};

/** Agents consultés en réunion (hors réception). */
export const DEFAULT_MEETING_PARTICIPANTS = [
  "openclaw:chef",
  "openclaw:mgr-dev",
  "openclaw:mgr-lab",
  "openclaw:main",
] as const;

/** Au-delà de ce délai, les participants pending passent en failed et on synthétise avec les réponses reçues. */
export const MEETING_PARTICIPANT_TIMEOUT_MS = 5 * 60_000;

const ROLE_HINT: Record<string, string> = {
  "openclaw:chef": "Chef — vision marché / priorisation.",
  "openclaw:mgr-dev": "Manager Dev — tendances tech / outils / niches eBay.",
  "openclaw:mgr-lab": "Manager Lab — recherche marché / data / opportunités.",
  "openclaw:main": "Mac polyvalent — veille concrète / exécution.",
};

export function findActiveMeetingTask(): OfficeTask | null {
  const active = listOfficeTasks({ status: "active", limit: 30 });
  return (
    active.find((t) => t.meta.meeting === true && t.meta.synthesisDone !== true) ??
    active.find((t) => t.meta.meeting === true && !t.resultSummary) ??
    null
  );
}

export function findMeetingTaskByCommandId(commandId: string): OfficeTask | null {
  for (const t of listOfficeTasks({ limit: 50 })) {
    if (t.meta.meeting !== true) continue;
    const parts = getParticipants(t);
    if (parts.some((p) => p.commandId === commandId)) return t;
    if (t.meta.synthesisCommandId === commandId) return t;
  }
  return null;
}

function getParticipants(task: OfficeTask): MeetingParticipant[] {
  const raw = task.meta.participants;
  if (!Array.isArray(raw)) return [];
  return raw as MeetingParticipant[];
}

function participantPrompt(agentId: string, brief: string): string {
  const role = ROLE_HINT[agentId] ?? displayName({ id: agentId, kind: "openclaw", name: agentId } as OfficeAgent);
  const antiDelegate =
    agentId === "openclaw:main"
      ? "INTERDIT de déléguer ou de dire « Délégué à … ». Donne TOI-MÊME une proposition produit."
      : "Ne délègue pas. Ne spawn aucun agent. Réponds toi-même.";
  return [
    "[RÉUNION ALL-HANDS — tour de table]",
    `Sujet: ${brief}`,
    `Ton rôle: ${role}`,
    "",
    "Donne UNE proposition concrète (ex. produit eBay à vendre maintenant + justification courte + fourchette prix).",
    antiDelegate,
    "Pas de question en retour. Pas de markdown. 2–4 phrases max. Français.",
  ].join("\n");
}

function synthesisPrompt(task: OfficeTask, parts: MeetingParticipant[]): string {
  const lines = parts
    .filter((p) => p.response)
    .map((p) => `- ${displayName({ id: p.agentId, kind: "openclaw", name: p.agentId } as OfficeAgent)}: ${p.response}`);
  return [
    "[SYNTHÈSE RÉUNION ALL-HANDS — DÉCISION FINALE]",
    `Sujet: ${task.brief || task.title}`,
    "",
    "Avis collectés (réels, ne rien inventer en plus):",
    ...lines,
    "",
    "Tu es le Chef. Choisis UN seul meilleur objet / niche à vendre maintenant.",
    "Justifie en 4–6 phrases (demande, marge, liquidité).",
    "INTERDIT : spawn, déléguer, demander une analyse à un manager, markdown, listes de tâches.",
    "Format obligatoire : « Décision : <objet>. Pourquoi : … »",
  ].join("\n");
}

/** Lance une vraie réunion : ping chaque agent avec OpenClaw (pas de fast-chat). */
export function startAllHandsMeeting(opts: {
  brief: string;
  facilitatorAgentId: string;
  participantIds?: string[];
}): OfficeTask {
  const brief = opts.brief.trim().slice(0, 2000);
  const facilitator = opts.facilitatorAgentId;
  const ids = opts.participantIds?.length
    ? opts.participantIds
    : [...DEFAULT_MEETING_PARTICIPANTS];

  const task = createOfficeTask({
    title: `Réunion: ${brief.slice(0, 60)}`,
    brief,
    status: "working",
    phase: "meeting",
    assigneeAgentId: facilitator,
    reporterAgentId: "user",
    deliverTo: "user",
    meta: {
      meeting: true,
      facilitatorAgentId: facilitator,
      participants: [] as MeetingParticipant[],
      synthesisCommandId: null,
      synthesisDone: false,
      brief,
      meetingStartedAt: new Date().toISOString(),
    },
  });

  const participants: MeetingParticipant[] = [];

  for (const agentId of ids) {
    if (agentId === facilitator) continue;
    const text = participantPrompt(agentId, brief);
    const cmd = enqueueOfficeCommand(agentId, "message", {
      text,
      taskId: task.id,
      meetingRound: true,
      forceOpenClaw: true,
      meetingBrief: brief,
    });
    participants.push({
      agentId,
      commandId: cmd.id,
      status: "pending",
      response: null,
    });
    appendOfficeEvent(agentId, "user_message", {
      text: `[Réunion] ${brief.slice(0, 200)}`,
      role: "system",
      meeting: true,
      commandId: cmd.id,
      taskId: task.id,
    });
    appendOfficeEvent(facilitator, "system", {
      text: `→ ${displayName({ id: agentId, kind: "openclaw", name: agentId } as OfficeAgent)} consulté`,
      role: "system",
      meeting: true,
      taskId: task.id,
    });
    appendAgentLog(facilitator, "reflection", `→ ${displayName({ id: agentId, kind: "openclaw", name: agentId } as OfficeAgent)} consulté`, {
      taskId: task.id,
      meeting: true,
      targetAgentId: agentId,
    });
  }

  updateOfficeTask(task.id, {
    meta: {
      ...task.meta,
      participants,
    },
  });

  appendTaskEvent({
    taskId: task.id,
    kind: "note",
    fromAgent: "user",
    toAgent: facilitator,
    text: `Réunion lancée · ${participants.length} agents consultés`,
  });

  return getOfficeTask(task.id)!;
}

function updateParticipants(task: OfficeTask, parts: MeetingParticipant[]): OfficeTask | null {
  return updateOfficeTask(
    task.id,
    { meta: { ...task.meta, participants: parts } },
    undefined,
  );
}

function allParticipantsDone(parts: MeetingParticipant[]): boolean {
  return parts.length > 0 && parts.every((p) => p.status === "done" || p.status === "failed");
}

function enqueueSynthesis(task: OfficeTask, parts: MeetingParticipant[]): OfficeTask | null {
  const synthAgent = "openclaw:chef";
  const text = synthesisPrompt(task, parts);
  const cmd = enqueueOfficeCommand(synthAgent, "message", {
    text,
    taskId: task.id,
    meetingSynthesis: true,
    forceOpenClaw: true,
  });
  appendOfficeEvent(synthAgent, "user_message", {
    text: text.slice(0, 500),
    role: "system",
    meeting: true,
    taskId: task.id,
  });
  return updateOfficeTask(
    task.id,
    {
      status: "handoff",
      phase: "decision",
      assigneeAgentId: synthAgent,
      commandId: cmd.id,
      meta: {
        ...task.meta,
        synthesisCommandId: cmd.id,
        participants: parts,
      },
    },
    {
      kind: "handoff",
      fromAgent: task.assigneeAgentId,
      toAgent: synthAgent,
      text: "Synthèse réunion → Chef",
    },
  );
}

/** Appelé quand une commande liée à la réunion se termine. */
export function processMeetingAfterCommand(
  commandId: string,
  agentId: string,
  status: "done" | "failed",
  resultText: string,
): OfficeTask | null {
  const task = findMeetingTaskByCommandId(commandId);
  if (!task || task.meta.meeting !== true) return null;

  const facilitator = String(task.meta.facilitatorAgentId ?? task.assigneeAgentId ?? "openclaw:office");
  let parts = getParticipants(task);

  // Synthèse Chef terminée → livraison user
  if (task.meta.synthesisCommandId === commandId) {
    const summary = resultText.slice(0, 2000);
    const updated = updateOfficeTask(
      task.id,
      {
        status: "done",
        phase: "done",
        resultSummary: summary,
        meta: { ...task.meta, synthesisDone: true, delivered: true },
      },
      {
        kind: "note",
        fromAgent: agentId,
        toAgent: "user",
        text: `Synthèse livrée (${summary.slice(0, 120)}…)`,
      },
    );
    appendOfficeEvent(facilitator, "agent_message", {
      text: summary,
      role: "agent",
      meeting: true,
      taskId: task.id,
      synthesis: true,
    });
    const facilitatorAgent = getAggregatedOfficeAgent(facilitator);
    const doneMeta: Record<string, unknown> = {
      ...(facilitatorAgent?.meta ?? {}),
      meetingTaskId: task.id,
    };
    delete doneMeta.pendingCommand;
    upsertOfficeAgent({
      id: facilitator,
      kind: "openclaw",
      name: facilitatorAgent?.name ?? "Réception",
      status: "idle",
      task: null,
      currentAction: null,
      lastSeenAt: new Date().toISOString(),
      meta: doneMeta,
    });
    return updated;
  }

  // Réponse participant
  parts = parts.map((p) =>
    p.commandId === commandId
      ? {
          ...p,
          status: status === "done" ? "done" : "failed",
          response: resultText.slice(0, 1500) || (status === "failed" ? "(échec)" : null),
        }
      : p,
  );

  const idx = parts.findIndex((p) => p.commandId === commandId);
  if (idx >= 0) {
    appendTaskEvent({
      taskId: task.id,
      kind: "note",
      fromAgent: parts[idx]!.agentId,
      toAgent: facilitator,
      text: parts[idx]!.response?.slice(0, 400) ?? "(pas de réponse)",
    });
    appendOfficeEvent(facilitator, "system", {
      text: `← ${displayName({ id: parts[idx]!.agentId, kind: "openclaw", name: parts[idx]!.agentId } as OfficeAgent)} a répondu`,
      role: "system",
      meeting: true,
    });
    appendAgentLog(
      facilitator,
      "reflection",
      `← ${displayName({ id: parts[idx]!.agentId, kind: "openclaw", name: parts[idx]!.agentId } as OfficeAgent)}: ${parts[idx]!.response?.slice(0, 120) ?? "(pas de réponse)"}`,
      { taskId: task.id, meeting: true },
    );
  }

  let current = updateParticipants(task, parts);
  if (!current) return null;

  const doneCount = parts.filter((p) => p.status === "done" || p.status === "failed").length;
  if (doneCount < parts.length) {
    return updateOfficeTask(
      current.id,
      { status: "working", phase: "meeting" },
      { kind: "status", text: `${doneCount}/${parts.length} réponses` },
    );
  }

  if (!current.meta.synthesisCommandId && allParticipantsDone(parts)) {
    return enqueueSynthesis(current, parts);
  }

  return current;
}

/** Marque les participants en timeout et lance la synthèse Chef si au moins une réponse existe. */
export function processMeetingTimeouts(nowMs = Date.now()): OfficeTask | null {
  const task = findActiveMeetingTask();
  if (!task || task.meta.meeting !== true || task.meta.synthesisCommandId) return null;

  const startedRaw = task.meta.meetingStartedAt;
  const startedAt =
    typeof startedRaw === "string" ? new Date(startedRaw).getTime() : Number.NaN;
  if (!Number.isFinite(startedAt) || nowMs - startedAt < MEETING_PARTICIPANT_TIMEOUT_MS) {
    return null;
  }

  let parts = getParticipants(task);
  let changed = false;
  parts = parts.map((p) => {
    if (p.status !== "pending") return p;
    changed = true;
    return {
      ...p,
      status: "failed" as const,
      response: "(timeout)",
    };
  });
  if (!changed) return null;

  let current = updateParticipants(task, parts);
  if (!current) return null;

  const doneCount = parts.filter((p) => p.status === "done").length;
  if (doneCount === 0) {
    return updateOfficeTask(
      current.id,
      { status: "failed", phase: "failed", resultSummary: "Réunion expirée — aucune réponse reçue." },
      { kind: "status", text: "Timeout réunion sans réponse" },
    );
  }

  if (allParticipantsDone(parts)) {
    return enqueueSynthesis(current, parts);
  }
  return current;
}

/** Réponse factuelle pour « des nouvelles ? » — sans LLM. */
export function buildMeetingStatusReply(facilitatorAgentId: string): string {
  const task = findActiveMeetingTask();
  if (!task) {
    const last = listOfficeTasks({ limit: 20 }).find((t) => t.meta.meeting === true && t.resultSummary);
    if (last?.resultSummary) {
      return `Dernière réunion (${last.title}):\n${last.resultSummary}`;
    }
    return "Aucune réunion active. Ta demande précédente n’a peut‑être pas déclenché la coordination (formulation non reconnue). Réessaie par ex. : « meeting avec tout le monde — meilleur objet eBay ».";
  }

  const parts = getParticipants(task);
  const done = parts.filter((p) => p.status === "done").length;
  const failed = parts.filter((p) => p.status === "failed").length;
  const pending = parts.filter((p) => p.status === "pending").length;

  if (task.meta.synthesisCommandId && !task.meta.synthesisDone) {
    return `Réunion en cours — synthèse Chef (${done}/${parts.length} avis reçus). Patiente encore un peu.`;
  }

  if (task.resultSummary) {
    return task.resultSummary;
  }

  const lines: string[] = [
    `Réunion: ${task.brief || task.title}`,
    `Avancement: ${done}/${parts.length} réponses${failed ? `, ${failed} échec(s)` : ""}${pending ? `, ${pending} en attente` : ""}.`,
  ];

  for (const p of parts) {
    const name = displayName({ id: p.agentId, kind: "openclaw", name: p.agentId } as OfficeAgent);
    if (p.status === "done" && p.response) {
      lines.push(`${name}: ${p.response.slice(0, 180)}${p.response.length > 180 ? "…" : ""}`);
    } else if (p.status === "failed") {
      lines.push(`${name}: (pas de réponse)`);
    } else {
      lines.push(`${name}: en cours…`);
    }
  }

  if (done === parts.length && parts.length > 0) {
    lines.push("Synthèse Chef en préparation…");
  }

  return lines.join("\n");
}

/** Poste la réponse réunion directement (évite hallucination fast-chat). */
export function deliverMeetingStatusToChat(facilitatorAgentId: string, userAsk: string): void {
  appendOfficeEvent(facilitatorAgentId, "user_message", {
    text: userAsk,
    role: "user",
  });
  const reply = buildMeetingStatusReply(facilitatorAgentId);
  appendOfficeEvent(facilitatorAgentId, "agent_message", {
    text: reply,
    role: "agent",
    meetingStatus: true,
  });
}
