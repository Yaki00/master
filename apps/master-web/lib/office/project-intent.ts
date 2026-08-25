/** Intentions projet extraites du langage naturel (chat agents). */

export type ProjectSpeechIntent =
  | {
      kind: "create";
      title: string;
      projectKind: "punctual" | "recurring";
      schedule?: string | null;
      brief?: string;
      notes?: string;
    }
  | {
      kind: "update";
      titleQuery: string;
      patch: {
        title?: string;
        status?: "draft" | "active" | "paused" | "done";
        notes?: string;
        brief?: string;
        schedule?: string | null;
        kind?: "punctual" | "recurring";
      };
    }
  | {
      kind: "delete";
      titleQuery: string;
    }
  | null;

const CREATE_RE =
  /\b(?:cr[eé]e|créer|creer|ajoute|ouvrir|lance)\b[\s\S]{0,40}?\bprojet\b/i;
const UPDATE_RE =
  /\b(?:modifie|renomme|mets?[-\s]?[aà]\s*jour|pause|reprends?|termine|cl[oô]ture|active)\b[\s\S]{0,40}?\bprojet\b/i;
const DELETE_RE =
  /\b(?:supprime|efface|archive|supprimer)\b[\s\S]{0,40}?\bprojet\b/i;

function extractQuoted(text: string): string | null {
  const m =
    text.match(/[«"]([^»"]{2,80})[»"]/) ||
    text.match(/\bprojet\s+(?:nomm[eé]|appel[eé]|:\s*)([^.!?\n]{2,80})/i) ||
    text.match(/\bprojet\s+([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 \-]{1,60})/i);
  return m?.[1]?.trim().replace(/\s+/g, " ").slice(0, 120) || null;
}

function extractAfterProjet(text: string): string | null {
  const m = text.match(
    /\bprojet\s+(?:nomm[eé]\s+|appel[eé]\s+|:\s*)?([^.!?\n,]{2,100})/i,
  );
  if (!m?.[1]) return null;
  let t = m[1].trim();
  t = t.replace(/\b(qui|avec|pour|et|récurrent|ponctuel|tous?\s+les).*$/i, "").trim();
  return t.slice(0, 120) || null;
}

export function parseProjectSpeech(text: string): ProjectSpeechIntent {
  const raw = text.trim();
  if (!raw || !/\bprojet\b/i.test(raw)) return null;

  if (DELETE_RE.test(raw)) {
    const titleQuery = extractQuoted(raw) || extractAfterProjet(raw);
    if (!titleQuery) return null;
    return { kind: "delete", titleQuery };
  }

  if (UPDATE_RE.test(raw) || /\bprojet\b.+\b(pause|terminé|termine|actif|active|draft)\b/i.test(raw)) {
    const titleQuery = extractQuoted(raw) || extractAfterProjet(raw);
    if (!titleQuery) return null;
    const patch: {
      title?: string;
      status?: "draft" | "active" | "paused" | "done";
      notes?: string;
      brief?: string;
      schedule?: string | null;
      kind?: "punctual" | "recurring";
    } = {};
    if (/\bpause\b/i.test(raw)) patch.status = "paused";
    if (/\b(reprend|active|actif)\b/i.test(raw)) patch.status = "active";
    if (/\b(termine|termin[eé]|cl[oô]ture|done|fini)\b/i.test(raw)) patch.status = "done";
    const rename = raw.match(/\brenomme\b[\s\S]{0,20}?(?:en|→|->)\s*[«"]?([^»"\n.]{2,80})/i);
    if (rename?.[1]) patch.title = rename[1].trim();
    const notes = raw.match(/\bnotes?\s*:\s*([^.!\n]{2,400})/i);
    if (notes?.[1]) patch.notes = notes[1].trim();
    const brief = raw.match(/\bbrief\s*:\s*([^.!\n]{2,400})/i);
    if (brief?.[1]) patch.brief = brief[1].trim();
    if (/\br[eé]current\b/i.test(raw)) patch.kind = "recurring";
    if (/\bponctuel\b/i.test(raw)) patch.kind = "punctual";
    const sched = raw.match(/\b(?:chaque|toutes?\s+les|planning)\s+([^.!\n]{2,80})/i);
    if (sched?.[1]) patch.schedule = sched[1].trim();
    if (Object.keys(patch).length === 0) patch.notes = raw.slice(0, 400);
    return { kind: "update", titleQuery, patch };
  }

  if (CREATE_RE.test(raw) || /\bnouveau\s+projet\b/i.test(raw)) {
    const title =
      extractQuoted(raw) ||
      extractAfterProjet(raw) ||
      raw.match(/\bnouveau\s+projet\s+([^.!?\n]{2,80})/i)?.[1]?.trim() ||
      "Sans titre";
    const recurring = /\br[eé]current\b|\bchaque\b|\btoutes?\s+les\b/i.test(raw);
    const sched = raw.match(/\b(?:chaque|toutes?\s+les|planning)\s+([^.!\n]{2,80})/i);
    const brief = raw.match(/\b(?:brief|pour|afin\s+de)\s*[:\s]+([^.!\n]{4,400})/i)?.[1]?.trim();
    return {
      kind: "create",
      title: title.slice(0, 160),
      projectKind: recurring ? "recurring" : "punctual",
      schedule: sched?.[1]?.trim() || null,
      brief: brief || raw.slice(0, 500),
      notes: "",
    };
  }

  return null;
}

/** Trouve un projet par titre approximatif. */
export function matchProjectByTitle<T extends { id: string; title: string }>(
  projects: T[],
  query: string,
): T | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const exact = projects.find((p) => p.title.toLowerCase() === q);
  if (exact) return exact;
  const starts = projects.find((p) => p.title.toLowerCase().startsWith(q));
  if (starts) return starts;
  return projects.find((p) => p.title.toLowerCase().includes(q)) ?? null;
}
