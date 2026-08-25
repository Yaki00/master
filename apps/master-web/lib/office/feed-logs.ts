import { feedToBubbles, type FeedBubble } from "./feed";
import type { OfficeAgent, OfficeEvent } from "./types";

export type FeedLogKind = "user" | "agent" | "system" | "spawn" | "handoff" | "progress" | "error";

export type FeedLogLine = {
  id: string;
  agentId: string;
  agentLabel: string;
  kind: FeedLogKind;
  text: string;
  createdAt: string;
};

function classifyKind(b: FeedBubble): FeedLogKind {
  if (b.spawn) return "spawn";
  if (b.pending) return "progress";
  if (/handoff|passation|delegu/i.test(b.text)) return "handoff";
  if (b.role === "user") return "user";
  if (b.role === "agent") return "agent";
  if (/failed|impossible|erreur/i.test(b.text)) return "error";
  return "system";
}

/** Convertit les événements feed office en lignes de log colorables. */
export function feedEventsToLogs(
  events: OfficeEvent[],
  agents: OfficeAgent[],
  options?: { agentId?: string | null; kind?: FeedLogKind | "all"; limit?: number },
): FeedLogLine[] {
  const agentId = options?.agentId ?? null;
  const kindFilter = options?.kind ?? "all";
  const filtered = agentId ? events.filter((e) => e.agentId === agentId) : events;
  const bubbles = feedToBubbles(filtered, agents, options?.limit ?? 80);
  const lines = bubbles.map((b) => ({
    id: b.id,
    agentId: b.agentId,
    agentLabel: b.agentLabel,
    kind: classifyKind(b),
    text: b.text,
    createdAt: b.at,
  }));
  if (kindFilter === "all") return lines;
  return lines.filter((l) => l.kind === kindFilter);
}

export function formatLogTime(iso: string): string {
  return iso.slice(11, 19);
}
