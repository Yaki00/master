import type { OfficeAgent, OfficeCommand, OfficeEvent, OfficeStatus } from "./types";
import { extractReplyText } from "./reply";
import { agentRole, type OfficeRole } from "./role";

export type ChatBubble = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: string;
  pending?: boolean;
};

export type BubbleAlign = "left" | "right" | "center";
export type BubbleVisualRole = OfficeRole | "user" | "system";

export function bubbleAlign(role: ChatBubble["role"]): BubbleAlign {
  if (role === "user") return "right";
  if (role === "system") return "center";
  return "left";
}

export function resolveBubbleRole(
  bubbleRole: ChatBubble["role"],
  agent?: Pick<OfficeAgent, "id" | "kind" | "name"> | null,
): BubbleVisualRole {
  if (bubbleRole === "user") return "user";
  if (bubbleRole === "system") return "system";
  return agent ? agentRole(agent) : "worker";
}

export function agentStatusLabel(status: OfficeStatus): string {
  switch (status) {
    case "working":
      return "Actif";
    case "idle":
      return "Idle";
    case "waiting":
      return "Attente";
    case "error":
      return "Erreur";
    case "offline":
      return "Hors ligne";
  }
}

export function truncateRosterTask(task: string | null | undefined, max = 28): string {
  const t = (task ?? "").trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Ligne tâche roster — masque les bruits type statut « idle ». */
export function rosterTaskLine(agent: Pick<OfficeAgent, "status" | "task" | "currentAction">): string {
  const raw = (agent.currentAction || agent.task || "").trim();
  if (!raw) return "—";
  const low = raw.toLowerCase();
  if (low === agent.status || low === "idle" || low === "null" || low === "—") return "—";
  return truncateRosterTask(raw);
}

const AUTO_NOISE = /^(reprendre|best-effort\b.*|pause demandée|stop demandé)$/i;
const JOB_AGENT_KINDS = new Set(["completed", "progress", "paused", "agent_message", "spawn_tree"]);
const JOB_FAIL_KINDS = new Set(["failed", "command_failed"]);
const SKIP_KINDS = new Set(["created", "claimed", "cancelled", "command_resume"]);
const CONTROL_KINDS = new Set(["command_pause", "command_stop", "system"]);

function payloadText(ev: OfficeEvent): string {
  const p = ev.payload;
  const raw =
    (typeof p.text === "string" && p.text) ||
    (typeof p.resultText === "string" && p.resultText) ||
    (typeof p.result === "string" && p.result) ||
    (typeof p.userReply === "string" && p.userReply) ||
    (typeof p.message === "string" && p.message) ||
    (typeof p.error === "string" && p.error) ||
    (typeof p.note === "string" && p.note) ||
    "";
  return sanitizeChatText(raw);
}

export function sanitizeChatText(raw: string): string {
  let text = extractReplyText(raw);
  if (!text) return "";
  if (AUTO_NOISE.test(text)) return "";
  if (/Command failed:\s*openclaw/i.test(text) || /--timeout \d+ --json/i.test(text)) {
    return "L’agent n’a pas pu répondre. Réessaie.";
  }
  if (text.length > 2000) text = `${text.slice(0, 1980)}…`;
  return text;
}

/** Fil de chat : messages utiles seulement (pas le spam command_*). */
export function eventsToBubbles(
  events: OfficeEvent[],
  pending: OfficeCommand[] = [],
): ChatBubble[] {
  const bubbles: ChatBubble[] = [];
  const seenTexts = new Set<string>();

  const push = (id: string, role: ChatBubble["role"], text: string, at: string, pendingFlag?: boolean) => {
    if (!text) return;
    const key = `${role}:${text}`;
    if (seenTexts.has(key)) return;
    seenTexts.add(key);
    bubbles.push({ id, role, text, at, pending: pendingFlag });
  };

  for (const cmd of pending) {
    if (cmd.kind !== "message" && cmd.kind !== "resume") continue;
    const text = sanitizeChatText(typeof cmd.payload.text === "string" ? cmd.payload.text : "");
    if (!text) continue;
    push(`pending-${cmd.id}`, "user", text, cmd.createdAt, true);
  }

  const thinking = pending.some(
    (c) => (c.kind === "message" || c.kind === "resume") && (c.status === "queued" || c.status === "claimed"),
  );
  const interimForPending = new Set(
    events
      .filter((e) => e.payload.interim === true && typeof e.payload.commandId === "string")
      .map((e) => String(e.payload.commandId)),
  );
  if (thinking) {
    const cmd = pending.find((c) => c.kind === "message" || c.kind === "resume")!;
    // Si un interim est déjà là, pas besoin du « … » bloquant
    if (!interimForPending.has(cmd.id)) {
      push(`thinking-${cmd.id}`, "agent", "…", cmd.createdAt, true);
    }
  }

  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Un seul tick « Toujours en cours » par commande (le plus récent)
  const latestProgress = new Map<string, OfficeEvent>();
  for (const ev of ordered) {
    const t = payloadText(ev);
    const officeTick = ev.payload.progress === true || /^Toujours en cours/i.test(t);
    if (!officeTick) continue;
    const key = String(ev.payload.commandId ?? ev.agentId);
    const prev = latestProgress.get(key);
    if (!prev || ev.createdAt >= prev.createdAt) latestProgress.set(key, ev);
  }
  const keepProgressIds = new Set([...latestProgress.values()].map((e) => e.id));

  for (const ev of ordered) {
    const kind = ev.kind;
    if (SKIP_KINDS.has(kind) || (kind.startsWith("command_") && kind !== "command_failed" && !CONTROL_KINDS.has(kind))) continue;

    const text = payloadText(ev);
    const roleHint = String(ev.payload.role ?? "");
    const interim = ev.payload.interim === true;
    const officeTick = ev.payload.progress === true || /^Toujours en cours/i.test(text);

    if (officeTick) {
      if (!keepProgressIds.has(ev.id) || !text) continue;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!;
        if (b.role === "system" && /^Toujours en cours/i.test(b.text)) {
          bubbles.splice(i, 1);
          seenTexts.delete(`system:${b.text}`);
        }
      }
      push(ev.id, "system", text, ev.createdAt, true);
      continue;
    }

    if (CONTROL_KINDS.has(kind) || roleHint === "system") {
      if (!text) continue;
      push(ev.id, "system", text, ev.createdAt);
      continue;
    }

    const isUser =
      kind === "user_message" ||
      kind === "optimistic" ||
      kind === "resumed" ||
      roleHint === "user";
    const isAgent = JOB_AGENT_KINDS.has(kind) || roleHint === "agent";
    const isFail = JOB_FAIL_KINDS.has(kind);

    if (isUser) {
      push(ev.id, "user", text, ev.createdAt);
      continue;
    }
    if (isFail) {
      push(ev.id, "system", text, ev.createdAt);
      continue;
    }
    if (kind === "spawn_tree" || ev.payload.spawn === true) {
      push(ev.id, "system", text || "Spawn", ev.createdAt);
      continue;
    }
    if (isAgent) {
      if (/^best-effort/i.test(text)) continue;
      push(ev.id, "agent", text, ev.createdAt, interim || undefined);
    }
  }

  return bubbles.sort((a, b) => a.at.localeCompare(b.at)).slice(-40);
}

const TIME_SEPARATOR_GAP_MS = 5 * 60_000;

/** Heure locale HH:MM pour en-tête de bulle. */
export function formatBubbleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(11, 16);
  }
}

export function bubbleTimeGapMs(prevAt: string, at: string): number {
  return Math.abs(Date.parse(at) - Date.parse(prevAt));
}

/** Séparateur temporel relatif entre groupes de messages. */
export function formatTimeSeparator(iso: string, nowMs = Date.now()): string {
  const ms = nowMs - Date.parse(iso);
  if (ms < 60_000) return "À l'instant";
  if (ms < 3600_000) {
    const m = Math.max(1, Math.round(ms / 60_000));
    return `Il y a ${m} min`;
  }
  if (ms < 86400_000) {
    const h = Math.max(1, Math.round(ms / 3600_000));
    return `Il y a ${h} h`;
  }
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function needsTimeSeparator(prevAt: string | null | undefined, at: string): boolean {
  if (!prevAt) return true;
  return bubbleTimeGapMs(prevAt, at) >= TIME_SEPARATOR_GAP_MS;
}
