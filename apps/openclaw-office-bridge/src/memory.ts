/** Mémoire conversationnelle bureau : historique + compaction. */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const MEMORY_MAX_TURNS = 12;
export const MEMORY_RECENT_KEEP = 6;
export const MEMORY_MAX_CHARS = 4000;

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

export function parseHistoryPayload(payload: Record<string, unknown>): {
  history: ChatTurn[];
  summary?: string;
  roster: string[];
} {
  const history: ChatTurn[] = [];
  const raw = payload.history;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const role = rec.role === "assistant" || rec.role === "agent" ? "assistant" : "user";
      const content = typeof rec.content === "string" ? rec.content.trim() : "";
      if (!content) continue;
      history.push({ role, content: content.slice(0, 1500) });
    }
  }
  const summary =
    typeof payload.summary === "string" && payload.summary.trim()
      ? payload.summary.trim().slice(0, 1200)
      : undefined;
  const roster = Array.isArray(payload.roster)
    ? payload.roster.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
    : [];
  return { history, summary, roster };
}

export function formatTurnsForSummary(turns: ChatTurn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "Humain" : "Agent"}: ${t.content}`)
    .join("\n")
    .slice(0, 6000);
}
