import type { AgentPlacement, FloorSlot } from "./placement";
import { localToGlobal } from "./placement";
import type { OfficeAgent, WaitingJobSummary } from "./types";

const JOB_SLOT_POOL: FloorSlot[] = [
  { x: 44, y: 70, pose: "stand" },
  { x: 56, y: 70, pose: "stand" },
  { x: 44, y: 84, pose: "stand" },
  { x: 56, y: 84, pose: "stand" },
];

function occupiedSpotKeys(hallCore: AgentPlacement[]): Set<string> {
  const keys = new Set<string>();
  for (const p of hallCore) {
    keys.add(`${Math.round(p.global.x)}|${Math.round(p.global.y)}`);
    keys.add(`${Math.round(p.slot.x)}|${Math.round(p.slot.y)}`);
  }
  return keys;
}

function pickJobSlot(hallCore: AgentPlacement[], index: number): FloorSlot {
  const taken = occupiedSpotKeys(hallCore);
  for (let i = 0; i < JOB_SLOT_POOL.length; i++) {
    const slot = JOB_SLOT_POOL[(index + i) % JOB_SLOT_POOL.length]!;
    const key = `${Math.round(slot.x)}|${Math.round(slot.y)}`;
    if (!taken.has(key)) return slot;
  }
  const fallback = JOB_SLOT_POOL[index % JOB_SLOT_POOL.length]!;
  return { ...fallback, x: fallback.x + (index % 2 === 0 ? -2 : 2) };
}

export function hallShowsWaitingStyle(people: Array<{ agent: OfficeAgent }>): boolean {
  return people.some((p) => p.agent.status === "waiting" || p.agent.status === "error");
}

/** Évite job:* + PC pour le même travail dans le hall. */
export function filterHallJobPlacements(
  hallCore: AgentPlacement[],
  waitingJobs: WaitingJobSummary[],
  max = 3,
): AgentPlacement[] {
  const taken = new Set(hallCore.map((p) => p.agent.id));
  const pcWorkerIds = new Set(
    hallCore
      .filter((p) => p.agent.kind === "pc")
      .map((p) => String(p.agent.meta.workerId ?? p.agent.id.replace(/^pc:/, "")))
      .filter(Boolean),
  );
  const pcAgentIds = new Set(hallCore.filter((p) => p.agent.kind === "pc").map((p) => p.agent.id));

  return waitingJobs
    .filter((j) => {
      if (taken.has(`job:${j.id}`) || taken.has("job:waiting-queue")) return false;
      if (!j.claimedBy) return true;
      if (pcWorkerIds.has(j.claimedBy)) return false;
      if (pcAgentIds.has(`pc:${j.claimedBy}`)) return false;
      return true;
    })
    .slice(0, max)
    .map((j, i) => {
      const slot = pickJobSlot(hallCore, i);
      return {
        agent: {
          id: `job:${j.id}`,
          kind: "job" as const,
          name: j.prompt,
          room: "waiting" as const,
          status: "waiting" as const,
          task: j.prompt,
          currentAction: null,
          lastSeenAt: j.updatedAt,
          meta: { jobId: j.id },
        },
        room: "waiting" as const,
        slot,
        global: localToGlobal("waiting", slot),
      };
    });
}
