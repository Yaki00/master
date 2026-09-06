export type JobHuntSearchDecisionKind = "imported" | "skipped";

export type JobHuntSearchDecision = {
  id: string;
  runId: string;
  title: string;
  company: string;
  url: string;
  source: string;
  score: number | null;
  decision: JobHuntSearchDecisionKind;
  reason: string;
  listingId: string | null;
  createdAt: string;
};

export type JobHuntSearchRun = {
  id: string;
  sources: string[];
  minScore: number;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
  decisions: JobHuntSearchDecision[];
};

export const SEARCH_HISTORY_MAX = 10;

export type JobHuntListingStatus =
  | "new"
  | "reviewed"
  | "queued"
  | "applied"
  | "interview"
  | "offer"
  | "rejected"
  | "skipped";

export type JobHuntProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  timezone: string;
  cvBase: string;
  cvFileName: string;
  cvAnalyzedAt: string | null;
  stack: string[];
  targetRoles: string[];
  languages: string[];
  minSalaryEur: number | null;
  remoteOnly: boolean;
  preferredRegions: string[];
  coverLetterTemplate: string;
  platforms: string[];
  autoSearchEnabled: boolean;
  autoApplyEnabled: boolean;
  minScoreAutoApply: number;
  maxApplicationsPerDay: number;
  searchIntervalHours: number;
  lastSearchAt: string | null;
  lastAutoRunAt: string | null;
  updatedAt: string;
};

export type JobHuntListing = {
  id: string;
  title: string;
  company: string;
  url: string;
  applyUrl: string;
  source: string;
  description: string;
  requirements: string;
  benefits: string;
  location: string;
  salary: string;
  employmentType: string;
  remoteType: string;
  postedAt: string | null;
  tags: string[];
  score: number;
  status: JobHuntListingStatus;
  tailoredCv: string;
  coverLetter: string;
  notes: string;
  agentResult: string;
  agentError: string;
  pcJobId: string | null;
  appliedAt: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type JobHuntEvent = {
  id: string;
  listingId: string | null;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type JobHuntStats = {
  total: number;
  new: number;
  queued: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  appliedToday: number;
};

export type JobHuntAutomationStatus = {
  pcOnline: boolean;
  profileReady: boolean;
  autoSearchEnabled: boolean;
  autoApplyEnabled: boolean;
  lastSearchAt: string | null;
  lastAutoRunAt: string | null;
  applicationsRemainingToday: number;
  nextSearchEligibleAt: string | null;
};

export type JobPlatformDef = {
  slug: string;
  label: string;
  defaultLoginUrl: string;
};

export type JobPlatformCredentialInput = {
  loginUrl?: string;
  email?: string;
  useGoogleSso?: boolean;
  sessionReady?: boolean;
  notes?: string;
};

export type JobPlatformCredential = {
  platform: string;
  label: string;
  loginUrl: string;
  email: string;
  /** Toujours false — on ne stocke plus de mots de passe. */
  passwordSet: boolean;
  useGoogleSso: boolean;
  /** L'utilisateur s'est connecté sur le PC (cookies profil Job Hunt). */
  sessionReady: boolean;
  notes: string;
  updatedAt: string | null;
};

export const LISTING_STATUS_LABEL: Record<JobHuntListingStatus, string> = {
  new: "Nouvelle",
  reviewed: "Revu",
  queued: "Agent en cours",
  applied: "Envoyée",
  interview: "Entretien",
  offer: "Offre",
  rejected: "Refusée",
  skipped: "Ignorée",
};

export const EVENT_KIND_LABEL: Record<string, string> = {
  imported: "Offre importée",
  search_run: "Recherche lancée",
  tailor_started: "Adaptation CV démarrée",
  tailor_done: "CV adapté",
  apply_started: "Candidature démarrée",
  apply_paused: "Pause agent (validation)",
  apply_completed: "Formulaire rempli",
  apply_failed: "Échec candidature",
  status_changed: "Statut mis à jour",
  auto_run: "Cycle automatique",
  login_opened: "Connexion plateforme ouverte",
};

export const JOB_PLATFORM_DEFS: JobPlatformDef[] = [
  { slug: "linkedin", label: "LinkedIn", defaultLoginUrl: "https://www.linkedin.com/login" },
  {
    slug: "wttj",
    label: "Welcome to the Jungle",
    defaultLoginUrl: "https://www.welcometothejungle.com/fr/me/settings/account",
  },
  { slug: "indeed", label: "Indeed", defaultLoginUrl: "https://secure.indeed.com/account/login" },
  { slug: "remoteok", label: "RemoteOK", defaultLoginUrl: "https://remoteok.com/" },
  { slug: "weworkremotely", label: "We Work Remotely", defaultLoginUrl: "https://weworkremotely.com/" },
  { slug: "remotive", label: "Remotive", defaultLoginUrl: "https://remotive.com/" },
  { slug: "glassdoor", label: "Glassdoor", defaultLoginUrl: "https://www.glassdoor.fr/profile/login_input.htm" },
  { slug: "other", label: "Autre plateforme", defaultLoginUrl: "" },
];

export const DEFAULT_PLATFORMS = JOB_PLATFORM_DEFS.map((p) => p.label);

export const JOB_HUNT_MARKER = "[JOB_HUNT]";
export const JOB_HUNT_LOGIN_MARKER = "[JOB_HUNT_LOGIN]";

export function jobHuntPromptHeader(listingId: string, action: "tailor" | "apply"): string {
  return `${JOB_HUNT_MARKER}\nlisting_id: ${listingId}\naction: ${action}\n`;
}

export function jobHuntLoginPromptHeader(platform: string, loginUrl: string): string {
  return `${JOB_HUNT_LOGIN_MARKER}\nplatform: ${platform}\nurl: ${loginUrl}\n`;
}
