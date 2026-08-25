import type { OfficeAgent, WaitingJobSummary } from "./types";

const NAME_ALIASES: Record<string, string> = {
  main: "Main",
  office: "Réception",
  chef: "Chef",
  "mgr-dev": "Mgr Dev",
  "mgr-lab": "Mgr Lab",
  "telegram-pc": "Telegram",
  telegram: "Telegram",
  "pc-main": "PC",
  "yaki-pc": "PC",
};

const INTERNAL_TASK =
  /^(en pause|pause demandée|pause demandée…|stop demandé|stop demandé…|heartbeat|en attente|en attente d’une réponse|en attente d'une réponse|working|idle|running|thinking)$/i;

const ACTION_LABELS: Record<string, string> = {
  exec: "terminal",
  write: "écriture",
  read: "lecture",
  edit: "édition",
  apply_patch: "patch",
  browser: "web",
  web_search: "recherche",
  web_fetch: "fetch",
  search: "recherche",
  grep: "grep",
  git: "git",
};

export function displayName(agent: Pick<OfficeAgent, "id" | "kind" | "name" | "task">): string {
  const raw = (agent.name || agent.id).replace(/^(openclaw|pc|job):/i, "").trim();
  const key = raw.toLowerCase();
  if (NAME_ALIASES[key]) return NAME_ALIASES[key]!;
  if (agent.kind === "job") {
    const task = cleanTask(agent.task);
    if (task) return task.length > 22 ? `${task.slice(0, 20)}…` : task;
    if (/^[0-9a-f-]{8}/i.test(raw)) return "Job";
  }
  if (!raw) return "Agent";
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function cleanTask(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text.trim();
  if (!t) return null;
  if (/^agent:[a-z0-9_-]+:/i.test(t)) {
    const rest = t.split(":").slice(2).join(":").trim();
    if (!rest || !/\s/.test(rest)) return null;
    t = rest;
  }
  if (INTERNAL_TASK.test(t)) return null;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(t)) return null;
  if (!/\s/.test(t) && (/^(?:[\w.-]+\/)?(?:qwen|llama|llava|mistral|gemma)[\w.-]*:\S+$/i.test(t) || /^[\w.-]+:\d+b\b/i.test(t))) {
    return null;
  }
  t = t.replace(/\s+/g, " ");
  return t.slice(0, 140);
}

/** Libellé court pour une action / outil live. */
export function humanAction(action: string | null | undefined): string | null {
  const raw = cleanTask(action);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  if (ACTION_LABELS[key]) return ACTION_LABELS[key]!;
  const first = raw.split(/[\s:/]+/)[0]?.toLowerCase() ?? "";
  if (ACTION_LABELS[first]) return ACTION_LABELS[first]!;
  return raw.length > 24 ? `${raw.slice(0, 22)}…` : raw;
}

/** Route runtime OpenClaw affichée sur la carte agent (ex. Main → office). */
export function runtimeRouteHint(agent: Pick<OfficeAgent, "id">): string | null {
  const id = agent.id.replace(/^openclaw:/, "").toLowerCase();
  if (id === "main") return "→ office";
  return null;
}

export function speechBubble(agent: OfficeAgent): string | null {
  if (agent.meta.stopRequested === true) return "arrêt en cours…";
  if (agent.meta.pauseRequested === true) return "pause en cours…";
  if (agent.status === "working") {
    return cleanTask(agent.task) || humanAction(agent.currentAction);
  }
  if (agent.status === "waiting" || agent.status === "error") {
    return cleanTask(agent.task) || "besoin de toi";
  }
  return null;
}

export function waitingJobTarget(job: WaitingJobSummary, agents: OfficeAgent[]): string {
  if (job.claimedBy) {
    const pc = agents.find(
      (a) => a.kind === "pc" && (a.id === `pc:${job.claimedBy}` || a.meta.workerId === job.claimedBy),
    );
    if (pc) return pc.id;
  }
  return `job:${job.id}`;
}
