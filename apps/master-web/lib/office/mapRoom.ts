import type { OfficeRoom, OfficeStatus } from "./types";

export type MapRoomInput = {
  status: OfficeStatus;
  currentAction?: string | null;
  tools?: string[] | null;
  meeting?: boolean;
  /** openclaw:office | openclaw:chef | … — postes fixes CDC-06 */
  agentId?: string | null;
};

/** Profils OpenClaw génériques — ne doivent pas décider la salle seuls. */
const PROFILE_NOISE = /^(coding|browser|default|full|tools|alsoallow)$/i;

const RESEARCH_RE =
  /browser|web_?search|web_?fetch|search|scrape|fetch|http|research|browse|crawl|sessions_spawn/;
const DEV_RE =
  /exec|write|read|edit|terminal|bash|shell|npm|git|code|patch|apply_patch|compile|docker|grep|cargo|python|node|go\b|file/;

function roleHome(agentId: string | null | undefined): OfficeRoom | null {
  if (!agentId) return null;
  const id = agentId.replace(/^openclaw:/, "").toLowerCase();
  if (id === "office") return "lounge";
  if (id === "chef") return "meeting";
  if (id === "mgr-dev") return "dev";
  if (id === "mgr-lab") return "research";
  if (id === "telegram-pc") return "lounge";
  return null;
}

function liveTools(tools: string[] | null | undefined): string[] {
  return (tools ?? []).map(String).filter((t) => t && !PROFILE_NOISE.test(t));
}

/**
 * working + browser/search → research
 * working + exec/write → dev
 * paused / besoin humain → waiting
 * idle / offline → lounge (sauf postes fixes chef/mgr)
 * meeting seulement si flag ET working
 */
export function mapRoom(input: MapRoomInput): OfficeRoom {
  if (input.status === "waiting") return "waiting";
  if (input.status === "error") return "waiting";
  if (input.status === "offline") return "lounge";

  const home = roleHome(input.agentId);

  // Postes fixes quand idle / pas en erreur
  if (input.status === "idle" && home) {
    return home === "lounge" ? "lounge" : home;
  }

  if (input.meeting && input.status === "working") return "meeting";

  const action = String(input.currentAction ?? "").toLowerCase();
  const tools = liveTools(input.tools);
  const toolsBlob = tools.join(" ").toLowerCase();

  if (input.status === "working") {
    // currentAction prime sur le profil d’outils
    if (action) {
      if (RESEARCH_RE.test(action)) return "research";
      if (DEV_RE.test(action)) return "dev";
    }
    if (RESEARCH_RE.test(toolsBlob)) return "research";
    if (DEV_RE.test(toolsBlob)) return "dev";
    // Rôle fixe même en working si pas d’outil discriminant
    if (home === "meeting" || home === "dev" || home === "research") return home;
    return "dev";
  }

  if (home && home !== "lounge") return home;
  return "lounge";
}

export function isOfficeStatus(value: string): value is OfficeStatus {
  return value === "working" || value === "idle" || value === "waiting" || value === "error" || value === "offline";
}

/** Normalise une tâche pour détecter un sujet partagé (Meeting). */
export function normalizeTaskSubject(task: string | null | undefined): string | null {
  if (!task) return null;
  const cleaned = task
    .toLowerCase()
    .replace(/^agent:[a-z0-9_-]+:/i, "")
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return cleaned.length >= 4 ? cleaned : null;
}
