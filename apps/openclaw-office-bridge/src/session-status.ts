/** Logique statut session OpenClaw — testable hors CLI. */

export type SessionLike = {
  status?: unknown;
  abortedLastRun?: unknown;
  updatedAt?: unknown;
  lastInteractionAt?: unknown;
  key?: unknown;
  model?: unknown;
  title?: unknown;
  lastUserMessage?: unknown;
  lastTool?: unknown;
  tools?: unknown;
};

export type DerivedStatus = "working" | "idle" | "waiting" | "error" | "offline";

const WORKING_STATUSES = new Set(["running", "in_progress", "active", "thinking", "streaming"]);
const DEAD_STATUSES = new Set(["killed", "done", "completed", "cancelled"]);

const RECENT_MS = 3 * 60_000;
const WORKING_WINDOW_MS = 2 * 60_000;

export function sessionAgeMs(session: SessionLike | null, now = Date.now()): number {
  if (!session) return Number.POSITIVE_INFINITY;
  const ts = Number(session.updatedAt ?? session.lastInteractionAt ?? NaN);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  // OpenClaw parfois en ms epoch « futur » — si ts > now+1j, traiter comme age inconnu via abs
  const age = now - ts;
  if (age < -86_400_000) return Number.POSITIVE_INFINITY;
  return Math.abs(age);
}

export function statusFromSession(session: SessionLike | null, now = Date.now()): DerivedStatus {
  if (!session) return "idle";
  const status = String(session.status ?? "").toLowerCase();
  const age = sessionAgeMs(session, now);
  const aborted = session.abortedLastRun === true;
  const dead = aborted || DEAD_STATUSES.has(status);

  // working explicite seulement si statut live
  if (WORKING_STATUSES.has(status)) {
    // mais pas si la session est vieille (CLI zombie)
    if (age > WORKING_WINDOW_MS) return "idle";
    return "working";
  }

  // Erreur seulement si échec récent
  if ((status === "error" || (aborted && status === "killed")) && age < RECENT_MS) {
    return "error";
  }

  // Fenêtre courte sans statut running → working seulement si vraiment frais
  if (!dead && age < WORKING_WINDOW_MS && status !== "done" && status !== "error" && status !== "") {
    // status vide + récent = souvent fin de run → idle si > 30s
    if (!status && age > 30_000) return "idle";
    if (status) return "working";
  }

  // Sessions mortes anciennes → idle (Lounge), pas Waiting
  if (dead) return "idle";

  return "idle";
}

const MODEL_ID =
  /^(?:[\w.-]+\/)?(?:qwen|llama|llava|mistral|gemma|deepseek)[\w.-]*:\S+$/i;

export function isModelId(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return MODEL_ID.test(t) || /^[\w.-]+:\d+b\b/i.test(t);
}

export function readableTask(session: SessionLike | null, fallbackName: string): string {
  if (!session) return fallbackName;
  const candidates = [
    session.lastUserMessage,
    session.title,
    session.key,
  ];
  for (const raw of candidates) {
    if (raw == null) continue;
    let text = String(raw).trim();
    if (!text) continue;
    // Strip session key noise agent:main:...
    if (/^agent:[a-z0-9_-]+:/i.test(text)) {
      const parts = text.split(":");
      text = parts.slice(2).join(":") || fallbackName;
    }
    if (text === "main" || text === "office" || text.length < 2) continue;
    if (isModelId(text)) continue;
    return text.slice(0, 160);
  }
  return fallbackName;
}

export function pickBureauSession(
  entries: Array<{ key: string; updatedAt: number; session: SessionLike }>,
  agentId: string,
): SessionLike | null {
  if (entries.length === 0) return null;
  const officeKey = `agent:${agentId}:office`;
  const bureauKey = `agent:${agentId}:bureau`;
  let office: (typeof entries)[number] | null = null;
  let bureau: (typeof entries)[number] | null = null;
  let latest: (typeof entries)[number] | null = null;
  for (const e of entries) {
    if (!latest || e.updatedAt >= latest.updatedAt) latest = e;
    if (e.key === officeKey || /(^|:)office$/i.test(e.key)) {
      if (!office || e.updatedAt >= office.updatedAt) office = e;
    }
    if (e.key === bureauKey || /(^|:)bureau$/i.test(e.key)) {
      if (!bureau || e.updatedAt >= bureau.updatedAt) bureau = e;
    }
  }
  return bureau?.session ?? office?.session ?? latest?.session ?? null;
}

export function toolsFromSession(
  session: SessionLike | null,
  configTools: string[] = [],
): { tools: string[]; currentAction: string | null } {
  const PROFILE = /^(coding|browser|default|full|tools)$/i;
  const live: string[] = [];
  if (session?.lastTool) live.push(String(session.lastTool));
  if (Array.isArray(session?.tools)) {
    for (const t of session.tools) {
      const s = String(t);
      if (s && !PROFILE.test(s)) live.push(s);
    }
  }
  const status = String(session?.status ?? "");
  // Prefer live tools from session activity; never dump coding+browser profile
  if (live.length > 0) {
    return { tools: live, currentAction: live[0] ?? (status || null) };
  }
  if (WORKING_STATUSES.has(status.toLowerCase()) || sessionAgeMs(session) < WORKING_WINDOW_MS) {
    return { tools: [], currentAction: status || "working" };
  }
  // configTools kept for API compat but intentionally unused for room mapping
  void configTools;
  return { tools: [], currentAction: status || "idle" };
}
