import type { OfficeAgent } from "./types";
import { displayName } from "./labels";

export type MentionTarget =
  | { kind: "all" }
  | { kind: "agent"; agentId: string; label: string }
  | { kind: "none" };

const ALL_RE = /^@(all|everyone|tous)\b/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Alias courts → id openclaw */
const ALIASES: Record<string, string> = {
  office: "openclaw:office",
  reception: "openclaw:office",
  sec: "openclaw:office",
  secretaire: "openclaw:office",
  chef: "openclaw:chef",
  boss: "openclaw:chef",
  main: "openclaw:main",
  mgrdev: "openclaw:mgr-dev",
  mgr: "openclaw:mgr-dev",
  mgrlab: "openclaw:mgr-lab",
  lab: "openclaw:mgr-lab",
  telegram: "openclaw:telegram-pc",
  tg: "openclaw:telegram-pc",
};

/**
 * Parse `@chef message` / `@all message`.
 * Retourne le texte sans le préfixe mention.
 */
export function parseMention(
  raw: string,
  agents: OfficeAgent[],
): { target: MentionTarget; text: string } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("@")) {
    return { target: { kind: "none" }, text: trimmed };
  }

  const all = trimmed.match(ALL_RE);
  if (all) {
    const text = trimmed.slice(all[0].length).trim();
    return { target: { kind: "all" }, text: text || "Statut ?" };
  }

  const m = trimmed.match(/^@([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) return { target: { kind: "none" }, text: trimmed };
  const token = m[1]!.trim();
  const text = (m[2] ?? "").trim() || "Statut ?";
  const key = norm(token);

  const aliasId = ALIASES[key];
  if (aliasId) {
    const hit = agents.find((a) => a.id === aliasId) ?? agents.find((a) => a.id.endsWith(aliasId.replace(/^openclaw:/, "")));
    if (hit || aliasId.startsWith("openclaw:")) {
      const agentId = hit?.id ?? aliasId;
      return {
        target: { kind: "agent", agentId, label: hit ? displayName(hit) : token },
        text,
      };
    }
  }

  for (const a of agents) {
    const names = [displayName(a), a.name, a.id.replace(/^openclaw:/, "")].map(norm);
    if (names.includes(key) || names.some((n) => n.includes(key) || key.includes(n))) {
      return { target: { kind: "agent", agentId: a.id, label: displayName(a) }, text };
    }
  }

  return { target: { kind: "none" }, text: trimmed };
}

/** Destinataires pour @all : openclaw online hors jobs. */
export function allMentionTargets(agents: OfficeAgent[]): OfficeAgent[] {
  return agents.filter(
    (a) =>
      a.kind === "openclaw" &&
      a.status !== "offline" &&
      !a.id.includes("subagent"),
  );
}

export type MentionSuggestion = { token: string; label: string };

const STATIC_SUGGESTIONS: MentionSuggestion[] = [
  { token: "@all ", label: "@all" },
  { token: "@chef ", label: "@chef" },
  { token: "@mgr-dev ", label: "@mgr-dev" },
  { token: "@mgr-lab ", label: "@mgr-lab" },
  { token: "@office ", label: "@office" },
];

/**
 * Suggestions `@…` pendant la frappe (préfixe après @).
 * Vide si le draft ne commence pas par `@` ou si un espace a déjà clos la mention.
 */
export function suggestMentions(draft: string, agents: OfficeAgent[] = []): MentionSuggestion[] {
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith("@")) return [];
  if (/\s/.test(trimmed.slice(1))) return [];

  const prefix = norm(trimmed.slice(1));
  const fromAgents: MentionSuggestion[] = agents
    .filter((a) => a.kind === "openclaw" && a.status !== "offline")
    .map((a) => {
      const short = a.id.replace(/^openclaw:/, "");
      return { token: `@${short} `, label: `@${short}` };
    });

  const pool = [...STATIC_SUGGESTIONS];
  for (const s of fromAgents) {
    if (!pool.some((p) => p.token === s.token)) pool.push(s);
  }

  if (!prefix) return pool.slice(0, 8);
  return pool.filter((s) => norm(s.label).includes(prefix) || norm(s.token).includes(prefix)).slice(0, 8);
}
