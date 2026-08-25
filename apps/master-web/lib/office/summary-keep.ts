/**
 * Décide si un résumé de conversation mérite d’être conservé.
 * Heuristique déterministe (pas de LLM) — missions, décisions, noms vs saluts / bruit.
 */

const USEFUL_RE =
  /\b(projet|mission|délègue|scan|build|fix|bug|todo|deadline|manager|chef|mgr|employé|spawn|code|deploy|rappel|plan|récurrent|hebdo|quotidien)\b/i;
const NOISE_RE =
  /^(bonjour|salut|hello|hey|ok|merci|bien|oui|non|test|ping|statut\??)\.?$/i;
const GREETING_HEAVY =
  /\b(bonjour|salut|comment ça va|je suis (là|disponible)|n['’]hésitez pas|ravi de)\b/i;

export type SummaryDecision = {
  keep: boolean;
  reason: string;
  score: number;
};

export function assessSummaryUsefulness(summary: string | null | undefined): SummaryDecision {
  const text = (summary ?? "").trim();
  if (!text) return { keep: false, reason: "vide", score: 0 };
  if (text.length < 24) return { keep: false, reason: "trop court", score: 1 };
  if (NOISE_RE.test(text)) return { keep: false, reason: "bruit / salut", score: 0 };

  let score = 2;
  if (text.length >= 80) score += 2;
  if (text.length >= 200) score += 1;
  if (USEFUL_RE.test(text)) score += 3;
  if (/\d/.test(text)) score += 1;
  if (/[•\-\*]|\d+\./.test(text)) score += 1; // liste / structure
  if (GREETING_HEAVY.test(text) && !USEFUL_RE.test(text)) score -= 3;
  if (/quelles options|comment puis-je/i.test(text)) score -= 2;

  const keep = score >= 5;
  return {
    keep,
    reason: keep ? "utile (contexte / mission)" : "peu utile",
    score,
  };
}

/** Applique la décision : retourne le résumé à stocker, ou null si drop. */
export function filterSummaryForStorage(summary: string | null | undefined): {
  summary: string | null;
  decision: SummaryDecision;
} {
  const decision = assessSummaryUsefulness(summary);
  if (!decision.keep) return { summary: null, decision };
  return { summary: String(summary).trim().slice(0, 1200), decision };
}
