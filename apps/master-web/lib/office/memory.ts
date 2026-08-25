import { listOfficeEvents, getStoredOfficeAgent, listAggregatedOfficeAgents, upsertOfficeAgent } from "@/lib/db/office";
import { eventsToBubbles } from "./chat";
import { displayName } from "./labels";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Au-delà → le sidecar doit résumer la partie ancienne. */
export const MEMORY_MAX_TURNS = 12;
export const MEMORY_RECENT_KEEP = 6;
export const MEMORY_MAX_CHARS = 4000;
export const MEMORY_SEND_CAP = 24;

export function turnsFromOfficeEvents(
  events: Parameters<typeof eventsToBubbles>[0],
): ChatTurn[] {
  return eventsToBubbles(events)
    .filter((b) => (b.role === "user" || b.role === "agent") && !b.pending && b.text !== "…")
    .map((b) => ({
      role: b.role === "user" ? ("user" as const) : ("assistant" as const),
      content: b.text,
    }));
}

export function historyChars(turns: ChatTurn[], summary = ""): number {
  return summary.length + turns.reduce((n, t) => n + t.content.length + 16, 0);
}

export function memoryOverQuota(turns: ChatTurn[], summary = ""): boolean {
  return turns.length > MEMORY_MAX_TURNS || historyChars(turns, summary) > MEMORY_MAX_CHARS;
}

export function splitForCompaction(turns: ChatTurn[], keep = MEMORY_RECENT_KEEP): {
  older: ChatTurn[];
  recent: ChatTurn[];
} {
  if (turns.length <= keep) return { older: [], recent: turns };
  return { older: turns.slice(0, -keep), recent: turns.slice(-keep) };
}

/** Historique + résumé + roster à coller sur la commande worker. */
export function buildMessageMemory(agentId: string): {
  history: ChatTurn[];
  summary?: string;
  roster: string[];
} {
  const stored = getStoredOfficeAgent(agentId);
  const rawSummary = stored?.meta?.chatSummary;
  const summary =
    typeof rawSummary === "string" && rawSummary.trim() ? rawSummary.trim().slice(0, 1200) : undefined;

  const events = listOfficeEvents(agentId, 100);
  let history = turnsFromOfficeEvents(events);
  if (summary) {
    // Après compaction, on n’envoie que le fil récent
    history = history.slice(-MEMORY_RECENT_KEEP);
  } else {
    history = history.slice(-MEMORY_SEND_CAP);
  }

  const roster = listAggregatedOfficeAgents()
    .filter((a) => a.status !== "offline")
    .map((a) => displayName(a))
    .filter(Boolean)
    .slice(0, 20);

  return { history, summary, roster };
}

export function setAgentChatSummary(agentId: string, summary: string): void {
  const agent = getStoredOfficeAgent(agentId);
  if (!agent) return;
  const text = summary.trim().slice(0, 1200);
  if (!text) return;
  upsertOfficeAgent({
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    status: agent.status,
    task: agent.task,
    currentAction: agent.currentAction,
    lastSeenAt: agent.lastSeenAt ?? new Date().toISOString(),
    meta: { ...agent.meta, chatSummary: text, chatSummaryAt: new Date().toISOString() },
  });
}
