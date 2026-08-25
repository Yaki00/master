/** Intents PM (orchestrateur projet) — parsing déterministe, sans LLM. */

export type PmPlanGateReply = "approve" | "reject" | "revise";

/**
 * Détecte un brief de projet complexe nécessitant orchestration d'équipe.
 * Ne matche PAS une simple sentinelle « surveille RTX… » sans signal PM fort.
 */
export function parsePmProjectStart(text: string): { title: string; brief: string } | null {
  const t = text.trim();
  if (!t || t.length < 12) return null;

  const strong =
    /\blance\s+un\s+projet\b/i.test(t) ||
    /\borganise\s+une\s+[ée]quipe\b/i.test(t) ||
    /\bprojet\s+complexe\b/i.test(t) ||
    /\bmission\s+compl[eè]te\b/i.test(t) ||
    /\bcr[eé]e\s+une\s+[ée]quipe\s+pour\b/i.test(t) ||
    /\bpilote\s+le\s+projet\b/i.test(t) ||
    (/\borganise\b/i.test(t) && /\b([ée]quipe|projet|mission)\b/i.test(t)) ||
    (/\b([ée]quipe)\b/i.test(t) &&
      /\b(lance|projet|mission|organise|pilote|adapte?e?)\b/i.test(t));

  if (!strong) return null;

  // Sentinelle CRUD simple sans équipe / mission PM : laisser parseProjectSpeech
  if (
    /\bsentinelle\b/i.test(t) &&
    /\b(cr[eé]e|créer|creer|ajoute)\b[\s\S]{0,40}\bprojet\b/i.test(t) &&
    !/\b([ée]quipe|organise|mission\s+compl|projet\s+complexe|lance\s+un\s+projet)\b/i.test(t)
  ) {
    return null;
  }

  const quoted =
    t.match(/[«"]([^»"]{2,80})[»"]/)?.[1]?.trim() ||
    t.match(/\bprojet\s+(?:nomm[eé]|appel[eé]|:\s*)([^.!?\n]{2,80})/i)?.[1]?.trim();

  let title =
    quoted ||
    t.match(/\blance\s+un\s+projet\s+([^.!?\n,]{3,80})/i)?.[1]?.trim() ||
    t.match(/\bpilote\s+le\s+projet\s+([^.!?\n,]{3,80})/i)?.[1]?.trim() ||
    "";

  if (title) {
    title = title
      .replace(/\b(avec|pour|et|récurrent|equipe|[ée]quipe|adapte?e?).*$/i, "")
      .trim()
      .slice(0, 120);
  }
  if (!title) {
    title = t.slice(0, 60).replace(/\s+/g, " ").trim() || "Projet PM";
  }

  return { title: title.slice(0, 160), brief: t.slice(0, 4000) };
}

export function parsePmPlanGateReply(text: string): PmPlanGateReply | null {
  const t = text.trim();
  if (!t) return null;

  // Pas de \b final : accents FR (é) ne sont pas des \w JS → \b échoue sur « approuvé »
  if (
    /^(?:ok(?:\s+go)?|go|oui|yes|yep)\s*[!.]?$/i.test(t) ||
    /approuv/i.test(t) ||
    /c['']est\s+bon/i.test(t) ||
    /\b(?:vas[- ]y|valide|d['']accord)\b/i.test(t)
  ) {
    // « révision » prioritaire si les deux matchent
    if (!/\br[eé]vis/i.test(t) && !/^ajoute\b/i.test(t)) {
      return "approve";
    }
  }

  if (/\b(rejette|refus|annule\s+le\s+plan|non\s+merci|abandonne)\b/i.test(t)) {
    return "reject";
  }

  if (
    /\b(r[eé]vision|r[eé]vise|ajoute|modifie\s+le\s+plan|plut[oô]t)\b/i.test(t) ||
    /^ajoute\b/i.test(t)
  ) {
    return "revise";
  }

  return null;
}

/** Statut projet PM (peut chevaucher réunion). */
export function parsePmStatusQuery(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 160) return false;
  if (/\b(statut\s+projet|avancement\s+projet|o[uù]\s+en\s+est\s+le\s+projet)\b/i.test(t)) {
    return true;
  }
  if (/\b(o[uù]\s+en\s+est[- ]?on|avancement|statut)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function parsePmCancelProject(text: string): { titleQuery: string } | null {
  const t = text.trim();
  if (!t) return null;
  const m =
    t.match(/\bannule\s+le\s+projet\s+[«"]?([^»"\n.!?]{2,80})/i) ||
    t.match(/\bannuler\s+le\s+projet\s+[«"]?([^»"\n.!?]{2,80})/i) ||
    t.match(/\bstop\s+le\s+projet\s+[«"]?([^»"\n.!?]{2,80})/i);
  if (!m?.[1]) {
    if (/\bannule\s+(ce\s+)?projet\b/i.test(t) || /\bannuler\s+(ce\s+)?projet\b/i.test(t)) {
      return { titleQuery: "" };
    }
    return null;
  }
  return { titleQuery: m[1].trim().replace(/[»"]+$/, "").slice(0, 120) };
}

/**
 * Réponse humaine à une question bloquante.
 * Le filtrage « session active » est fait par l'orchestrateur.
 */
export function parsePmHumanAnswer(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return t.slice(0, 4000);
}
