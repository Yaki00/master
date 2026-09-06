/** Intents PM (orchestrateur projet) — parsing déterministe, sans LLM. */

export type PmPlanGateReply = "approve" | "reject" | "revise";

const TRIVIAL_CHAT_RE =
  /^(salut|bonjour|bonsoir|hey|hi|hello|merci|ok|oui|non|thanks|thx)[\s!.?]*$/i;

const SIMPLE_SENTINEL_RE =
  /^\s*(surveille|veille|alerte[- ]?moi)\b/i;

/**
 * Demande assez riche pour un projet multi-agents (sans exiger « lance un projet »).
 * Exclut chat banal et sentinelles one-shot.
 */
export function looksLikePmWork(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 24) return false;
  if (TRIVIAL_CHAT_RE.test(t)) return false;
  if (SIMPLE_SENTINEL_RE.test(t) && t.length < 100 && !/\b([ée]quipe|mission|projet)\b/i.test(t)) {
    return false;
  }

  const strongVerb =
    /\b(mission|d[eé]l[eè]gue|delegue|assigne|redistribue|coordonne|organise|planifie|pilote|orchestre)\b/i.test(
      t,
    );
  const projectSignal =
    /\b(projet|sous-?t[aâ]ches?|[ée]quipe|équipe|handoff|multi.?agent)\b/i.test(t);
  const workVerb =
    /\b(analyse|construis|construire|impl[eé]mente|pr[eé]pare|livre|livrer|d[eé]veloppe|recherche|cadrage|synth[eè]se)\b/i.test(
      t,
    );
  const longActionable =
    t.length >= 80 &&
    /\b(fais|fait|cr[eé]e|creer|trouver|mettre|en place|besoin|je veux|j'aimerais|il me faut)\b/i.test(
      t,
    );

  return strongVerb || projectSignal || (workVerb && t.length >= 40) || longActionable;
}

/**
 * Détecte un brief nécessitant orchestration d'équipe.
 * Ne matche PAS une simple sentinelle « surveille RTX… » sans signal PM.
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

  // Réunion all-hands : laisser meeting.ts
  if (/\br[eé]union\b|\bmeeting\b|\ball[- ]?hands\b|\btout\s+le\s+monde\b/i.test(t)) {
    return null;
  }

  // Sentinelle CRUD simple sans équipe / mission PM : laisser parseProjectSpeech
  if (
    /\bsentinelle\b/i.test(t) &&
    /\b(cr[eé]e|créer|creer|ajoute)\b[\s\S]{0,40}\bprojet\b/i.test(t) &&
    !/\b([ée]quipe|organise|mission\s+compl|projet\s+complexe|lance\s+un\s+projet)\b/i.test(t)
  ) {
    return null;
  }

  // CRUD projet simple (« crée un projet X ») sans signal d’orchestration
  if (
    /\b(cr[eé]e|créer|creer|ajoute|supprime|mets?\s+[àa]\s+jour)\b[\s\S]{0,40}\bprojet\b/i.test(t) &&
    !strong &&
    !/\b(mission|d[eé]l[eè]gue|organise|pilote|[ée]quipe|adapte?e?)\b/i.test(t)
  ) {
    return null;
  }

  if (!strong && !looksLikePmWork(t)) return null;

  const quoted =
    t.match(/[«"]([^»"]{2,80})[»"]/)?.[1]?.trim() ||
    t.match(/\bprojet\s+(?:nomm[eé]|appel[eé]|:\s*)([^.!?\n]{2,80})/i)?.[1]?.trim();

  let title =
    quoted ||
    t.match(/\blance\s+un\s+projet\s+([^.!?\n,]{3,80})/i)?.[1]?.trim() ||
    t.match(/\bpilote\s+le\s+projet\s+([^.!?\n,]{3,80})/i)?.[1]?.trim() ||
    t.match(/\bmission\s+[:\-]?\s*([^.!?\n,]{3,80})/i)?.[1]?.trim() ||
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
