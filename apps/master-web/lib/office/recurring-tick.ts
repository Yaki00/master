import {
  listDueRecurringProjects,
  updateAiProject,
  type AiProject,
} from "@/lib/db/ai-projects";
import { enqueueOfficeCommand } from "@/lib/db/office";
import {
  computeNextRunAt,
  resolveSentinelIntervalMinutes,
} from "@/lib/office/scenario-helpers";
import { processMeetingTimeouts } from "@/lib/office/meeting";
import { processPmTimeouts } from "@/lib/office/project-orchestrator";
import { failStaleClaimedOfficeCommands } from "@/lib/db/office";

export type RecurringTickResult = {
  ticked: number;
  projectIds: string[];
  meetingTimeout: boolean;
  pmTimeouts: number;
  staleCommands: number;
};

function tickMessage(project: AiProject): string {
  const brief = project.brief.trim() || project.title;
  return [
    `[Tick sentinelle · ${project.title}]`,
    brief,
    "",
    "Scanne les sites indiqués. Si rien sous le seuil prix, réponds « aucune annonce » sans alerter l'humain.",
    "Si match intéressant, résume produit + prix + lien en 2–4 phrases.",
  ].join("\n");
}

function resolveTickAgent(project: AiProject): string {
  if (project.agentId?.startsWith("openclaw:")) return project.agentId;
  return "openclaw:mgr-dev";
}

/** Exécute les projets récurrents dus + timeouts réunion + watchdog PM (nudge/escalade). */
export function tickDueRecurringProjects(nowIso = new Date().toISOString()): RecurringTickResult {
  const due = listDueRecurringProjects(nowIso);
  const projectIds: string[] = [];

  for (const project of due) {
    const intervalMin = resolveSentinelIntervalMinutes(project);
    const agentId = resolveTickAgent(project);
    enqueueOfficeCommand(agentId, "message", {
      text: tickMessage(project),
      projectId: project.id,
      forceOpenClaw: true,
      sentinelTick: true,
    });
    updateAiProject(project.id, {
      nextRunAt: computeNextRunAt(nowIso, intervalMin),
    });
    projectIds.push(project.id);
  }

  const staleCommands = failStaleClaimedOfficeCommands(Date.now());
  const meetingTimeout = Boolean(processMeetingTimeouts(Date.now()));
  const pmTimeouts = processPmTimeouts(Date.now());

  return {
    ticked: projectIds.length,
    projectIds,
    meetingTimeout,
    pmTimeouts,
    staleCommands,
  };
}
