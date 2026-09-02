import type { JobHuntListing, JobHuntProfile } from "./types";
import { credentialHintForUrl, getPlatformCredential, platformSlugFromUrl } from "./credentials";
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
  const cred = slug ? getPlatformCredential(slug) : null;

  const loginBlock =
    cred && !cred.useGoogleSso && cred.email && cred.password
      ? [
          "## Identifiants plateforme (usage agent uniquement)",
          `URL login: ${cred.loginUrl}`,
          `Email: ${cred.email}`,
          `Mot de passe: ${cred.password}`,
        ].join("\n")
      : `Connexion: ${credentialHintForUrl(listing.url)}`;

  return [
    jobHuntPromptHeader(listing.id, "apply"),
    "[CANDIDATURE JOB HUNT — mode navigateur humain]",
    "",
    "Objectif: ouvrir l'offre d'emploi, remplir le formulaire de candidature, uploader le CV si demandé.",
    "NE PAS cliquer sur Envoyer/Submit sans confirmation explicite — pause avant le bouton final.",
    "",
    "Comptes: l'utilisateur utilise Google Password Manager dans Chrome/Firefox. Si une page de connexion apparaît,",
    "cliquer sur « Continuer avec Google » ou laisser le gestionnaire remplir — ne jamais demander le mot de passe.",
    "Si CAPTCHA ou 2FA: mettre le job en pause et décrire ce qui bloque.",
    "",
    `Connexion plateforme: ${credentialHintForUrl(listing.url)}`,
    loginBlock,
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
    "1. Ouvrir l'URL dans le navigateur",
    "2. Lire la page (vision) et localiser « Postuler » / « Apply »",
    "3. Remplir tous les champs visibles avec les infos ci-dessus",
    "4. Capturer un screenshot de la page pré-submit",
    "5. PAUSE — attendre validation utilisateur avant envoi final",
  ].join("\n");
}
