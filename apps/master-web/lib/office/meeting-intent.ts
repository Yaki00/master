/** Détecte une demande de réunion all-hands (coordination réelle, pas fast-chat). */

const MEETING_PHRASE_RE =
  /organis(?:e|er|ez)\s+(?:une\s+)?r[eé]union|r[eé]union\s+avec\s+tout\s+le\s+monde|meeting\s+avec\s+tout\s+le\s+monde|avec\s+tout\s+le\s+monde/i;

const MEETING_KEYWORD_RE =
  /\b(r[eé]union|meeting|all[-\s]?hands|tous?\s+le\s+monde|avec\s+tout|ensemble|convie|convoque)\b/i;

/** Typos fréquentes : meatting, metting, réunions… */
const MEETING_TYPO_RE = /\bme[ae]{1,2}t{1,2}ings?\b|\br[eé]uni+ons?\b/i;

const MEETING_ACTION_RE =
  /(?:organis(?:e|er|ez)|fait(?:es)?|lance(?:z)?|convie(?:z)?|convoque(?:z)?)\s+(?:un(?:e)?\s+)?(?:meeting|r[eé]union|all[-\s]?hands|me[ae]{1,2}t{1,2}ing)/i;

const MEETING_GROUP_RE =
  /\b(tout(?:e)?s?\s+le\s+monde|avec\s+tout|l['']?équipe|les\s+gens\s+conc(?:ern|ern)[eé]s?|ensemble)\b/i;

const STATUS_QUERY_RE =
  /\b(alors|des\s+nouvelles|nouvelles|o[uù]\s+en\s+(?:est|es|êtes)|status|statut|avancement|update|quoi\s+de\s+neuf|revenu|retour|synth[eè]se|r[eé]sultat)\b/i;

export function parseMeetingIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (MEETING_PHRASE_RE.test(t) || MEETING_KEYWORD_RE.test(t)) return true;
  if (MEETING_ACTION_RE.test(t)) return true;
  if (MEETING_TYPO_RE.test(t) && (MEETING_GROUP_RE.test(t) || /\bebay\b/i.test(t))) return true;
  if (/\bfait\b.*\bme[ae]{1,2}t{1,2}ing\b/i.test(t)) return true;
  return false;
}

export function parseMeetingStatusQuery(text: string): boolean {
  const t = text.trim();
  if (t.length > 120) return false;
  return STATUS_QUERY_RE.test(t);
}
