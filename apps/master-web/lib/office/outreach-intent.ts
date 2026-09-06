/** Intent + scaffolding : listing commerces sans site → CSV + mail. */

export type OutreachKind = "boulangerie" | "restaurant" | "commerce";

export type OutreachIntent = {
  kind: OutreachKind;
  zone: string;
  brief: string;
  title: string;
};

const KIND_RE =
  /\b(boulangeries?|restaurants?|commerces?|caf[eé]s?|pizz[eé]rias?|salons?\s+de\s+coiffure)\b/i;

/**
 * « liste les boulangeries sans site autour de Trappes »
 */
export function parseOutreachListIntent(text: string): OutreachIntent | null {
  const t = text.trim();
  if (!t || t.length < 16) return null;

  const wantsList = /\b(liste|lister|trouve|trouver|rep[eé]re|prospect)\b/i.test(t);
  const noSite = /\b(sans\s+site|pas\s+de\s+site|sans\s+internet|sans\s+page\s+web)\b/i.test(t);
  const kindHit = t.match(KIND_RE)?.[1]?.toLowerCase() ?? "";
  if (!wantsList || !noSite || !kindHit) return null;

  let kind: OutreachKind = "commerce";
  if (/boulang/i.test(kindHit)) kind = "boulangerie";
  else if (/restaur|pizz|caf/i.test(kindHit)) kind = "restaurant";

  const zone =
    t.match(/\b(?:autour\s+de|pr[eè]s\s+de|[àa]|dans|sur)\s+([A-Za-zÀ-ÿ0-9\s\-']{2,60})/i)?.[1]
      ?.replace(/\b(sans|avec|et|les?|des?|une?|pour)\b.*$/i, "")
      .trim() ||
    t.match(/\bzone\s*:\s*([^.!?\n]{2,60})/i)?.[1]?.trim() ||
    "";

  if (!zone || zone.length < 2) return null;

  const label =
    kind === "boulangerie" ? "boulangeries" : kind === "restaurant" ? "restaurants" : "commerces";
  const title = `${label} sans site · ${zone}`.slice(0, 120);
  const brief = [
    `Lister les ${label} sans site internet autour de ${zone}.`,
    "Pour chaque fiche: nom, adresse, téléphone si dispo, source, confiance (sûr/probable).",
    "Produire un CSV + un message e-mail type pour les contacter.",
    `Demande humaine: ${t.slice(0, 800)}`,
  ].join("\n");

  return { kind, zone: zone.slice(0, 80), brief, title };
}

export function outreachCsvTemplate(intent: OutreachIntent): string {
  const label =
    intent.kind === "boulangerie"
      ? "boulangerie"
      : intent.kind === "restaurant"
        ? "restaurant"
        : "commerce";
  return [
    "nom,adresse,telephone,ville,type,a_un_site,url_site,source,confiance,notes",
    `"Exemple ${label}","1 rue Exemple","01 00 00 00 00","${intent.zone}",${label},non,,maps,probable,"à vérifier par l'agent"`,
    "",
  ].join("\n");
}

export function outreachMailDraft(intent: OutreachIntent): string {
  const label =
    intent.kind === "boulangerie"
      ? "boulangerie"
      : intent.kind === "restaurant"
        ? "restaurant"
        : "commerce";
  return [
    `Objet: Proposition simple pour votre ${label} à ${intent.zone}`,
    "",
    "Bonjour,",
    "",
    `Je me permets de vous contacter au sujet de votre ${label} à ${intent.zone}.`,
    "Beaucoup de clients cherchent aujourd’hui vos horaires et votre carte en ligne,",
    "et je propose un site simple (présentation, horaires, contact) sans complication.",
    "",
    "Si cela vous intéresse, je peux vous envoyer un exemple et un tarif clair.",
    "",
    "Bien cordialement,",
    "[Ton prénom]",
    "[Téléphone]",
    "",
    "—",
    "Brouillon généré pour outreach. Adapte le ton avant envoi.",
  ].join("\n");
}

export function outreachReadme(intent: OutreachIntent): string {
  return [
    `# ${intent.title}`,
    "",
    intent.brief,
    "",
    "## Fichiers",
    "- `prospects.csv` — liste à compléter / enrichir",
    "- `mail-draft.txt` — message type à leur adresser",
    "",
    "## Suite",
    "L’agent recherche les fiches ; tu peux éditer le CSV et le mail ici.",
  ].join("\n");
}
