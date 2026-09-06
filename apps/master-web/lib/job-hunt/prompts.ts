import type { JobHuntListing, JobHuntProfile } from "./types";
import {
  credentialHintForUrl,
  jobHuntBrowserProfileHint,
  platformSlugFromUrl,
} from "./credentials";
import { jobHuntPromptHeader } from "./types";

export function buildTailorPrompt(profile: JobHuntProfile, listing: JobHuntListing): string {
  return [
    jobHuntPromptHeader(listing.id, "tailor"),
    "Tu es un expert carrière tech. Adapte le CV et rédige une lettre de motivation pour cette offre.",
    "",
    "## Profil candidat",
    `Nom: ${profile.fullName}`,
    `Email: ${profile.email}`,
    `Localisation: ${profile.location} (${profile.timezone})`,
    `Stack: ${profile.stack.join(", ")}`,
    `Postes recherchés: ${profile.targetRoles.join(", ") || "non renseigné"}`,
    `Langues: ${profile.languages.join(", ")}`,
    "",
    "## CV de base",
    profile.cvBase || "(non renseigné — demander à l'utilisateur de compléter le profil)",
    "",
    "## Offre",
    `Titre: ${listing.title}`,
    `Entreprise: ${listing.company}`,
    `URL: ${listing.url}`,
    `Lieu: ${listing.location}`,
    `Salaire: ${listing.salary || "non indiqué"}`,
    "",
    listing.description,
    "",
    "## Consignes",
    "1. Réécris le CV en markdown, ciblé sur les mots-clés de l'offre (sans mentir).",
    "2. Rédige une lettre de motivation courte (max 250 mots), en français ou anglais selon l'offre.",
    "3. Liste 3 points forts à mettre en avant pour cette offre.",
    "",
    "Réponds en JSON strict:",
    '{"tailoredCv":"...","coverLetter":"...","highlights":["...","...","..."]}',
  ].join("\n");
}

export function buildApplyPrompt(
  profile: JobHuntProfile,
  listing: JobHuntListing,
): string {
  const cv = listing.tailoredCv || profile.cvBase;
  const letter = listing.coverLetter || profile.coverLetterTemplate;
  const slug = platformSlugFromUrl(listing.url);

  return [
    jobHuntPromptHeader(listing.id, "apply"),
    "[CANDIDATURE JOB HUNT — session navigateur, pas de mots de passe]",
    "",
    "Objectif: ouvrir l'offre, remplir le formulaire, uploader le CV si demandé.",
    "NE PAS cliquer sur Envoyer/Submit sans confirmation explicite — pause avant le bouton final.",
    "",
    "## Auth (IMPORTANT)",
    `- Profil navigateur persistant: ${jobHuntBrowserProfileHint()}`,
    "- Ouvre Chrome/Chromium via open_app « chrome » (ce profil est utilisé) puis navigue vers l'URL.",
    "- Les cookies LinkedIn / Indeed / WTTJ doivent déjà être présents si l'utilisateur s'est connecté via Comptes.",
    "- NE JAMAIS demander, taper ou inventer un mot de passe.",
    "- Si page de login: pause (ask_user) pour que l'utilisateur se connecte lui-même sur le PC, puis reprendre.",
    "- Si « Continuer avec Google »: laisser l'utilisateur choisir le compte (ne pas automatiser le SSO).",
    `- Contexte plateforme: ${credentialHintForUrl(listing.url)}`,
    slug ? `- Plateforme détectée: ${slug}` : "",
    "",
    `URL offre: ${listing.applyUrl || listing.url}`,
    `Poste: ${listing.title} @ ${listing.company}`,
    "",
    `Nom: ${profile.fullName}`,
    `Email: ${profile.email}`,
    `Téléphone: ${profile.phone || "—"}`,
    "",
    "## CV à utiliser (texte)",
    cv.slice(0, 4000),
    "",
    "## Lettre de motivation",
    letter.slice(0, 2000),
    "",
    "Étapes:",
    "1. Ouvrir le navigateur Job Hunt (chrome) puis l'URL",
    "2. Vérifier que la session est connectée ; sinon ask_user",
    "3. Localiser « Postuler » / « Apply »",
    "4. Remplir les champs visibles avec les infos ci-dessus",
    "5. Capturer un screenshot de la page pré-submit",
    "6. PAUSE — attendre validation utilisateur avant envoi final",
  ]
    .filter(Boolean)
    .join("\n");
}
