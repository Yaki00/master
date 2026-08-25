import type { OfficeAgent, OfficeStatus } from "./types";

/** working sans commande live au-delà de ça → idle (CDC-01). */
export const WORKING_ORPHAN_MS = 120_000;

/**
 * Un agent openclaw ne peut pas rester « working » sans commande live
 * ni activité récente (lastSeen).
 */
export function reconcileAgentStatus(
  agent: OfficeAgent,
  opts: { liveCommand?: boolean; now?: number } = {},
): OfficeAgent {
  const now = opts.now ?? Date.now();
  const live = opts.liveCommand === true;
  const seen = new Date(agent.lastSeenAt).getTime();
  const age = Number.isFinite(seen) ? now - seen : Number.POSITIVE_INFINITY;

  if (agent.status === "working" && agent.kind === "openclaw" && !live && age > WORKING_ORPHAN_MS) {
    return {
      ...agent,
      status: "idle" as OfficeStatus,
      currentAction: agent.currentAction === "message" ? "idle" : agent.currentAction,
      meta: { ...agent.meta, pendingCommand: undefined, reconciled: "orphan-working" },
    };
  }

  if (agent.status === "error" && age > WORKING_ORPHAN_MS) {
    return {
      ...agent,
      status: "idle",
      meta: { ...agent.meta, reconciled: "stale-error" },
    };
  }

  return agent;
}
