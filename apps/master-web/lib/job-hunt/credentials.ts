import { deleteOfficeSecret, getOfficeSecret, setOfficeSecret } from "@/lib/db/office-secrets";
import { JOB_PLATFORM_DEFS, type JobPlatformCredential, type JobPlatformCredentialInput } from "./types";

const PREFIX = "job_hunt_platform:";

/** Auth = session navigateur sur le PC (cookies), jamais de mot de passe Master. */
type StoredCredential = {
  loginUrl: string;
  email: string;
  /** @deprecated ne plus stocker — vidé à la lecture/écriture */
  password?: string;
  useGoogleSso: boolean;
  sessionReady: boolean;
  notes: string;
  updatedAt: string;
};

function secretKey(slug: string): string {
  return `${PREFIX}${slug}`;
}

function defForSlug(slug: string) {
  return JOB_PLATFORM_DEFS.find((d) => d.slug === slug);
}

function readStored(slug: string): StoredCredential | null {
  const raw = getOfficeSecret(secretKey(slug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredCredential;
    // Purge mots de passe legacy au fil de l'eau
    if (parsed.password) {
      const cleaned: StoredCredential = {
        loginUrl: parsed.loginUrl,
        email: parsed.email ?? "",
        useGoogleSso: parsed.useGoogleSso ?? true,
        sessionReady: parsed.sessionReady ?? false,
        notes: parsed.notes ?? "",
        updatedAt: new Date().toISOString(),
      };
      setOfficeSecret(secretKey(slug), JSON.stringify(cleaned));
      return cleaned;
    }
    return {
      ...parsed,
      sessionReady: parsed.sessionReady ?? false,
      useGoogleSso: parsed.useGoogleSso ?? true,
    };
  } catch {
    return null;
  }
}

export function listPlatformCredentials(): JobPlatformCredential[] {
  return JOB_PLATFORM_DEFS.map((def) => {
    const stored = readStored(def.slug);
    return {
      platform: def.slug,
      label: def.label,
      loginUrl: stored?.loginUrl || def.defaultLoginUrl,
      email: stored?.email ?? "",
      passwordSet: false,
      useGoogleSso: stored?.useGoogleSso ?? true,
      sessionReady: stored?.sessionReady ?? false,
      notes: stored?.notes ?? "",
      updatedAt: stored?.updatedAt ?? null,
    };
  });
}

export function getPlatformCredential(slug: string): StoredCredential | null {
  return readStored(slug);
}

export function savePlatformCredential(
  slug: string,
  input: JobPlatformCredentialInput,
): JobPlatformCredential | null {
  const def = defForSlug(slug);
  if (!def) return null;

  const current = readStored(slug);
  const payload: StoredCredential = {
    loginUrl: input.loginUrl?.trim() || current?.loginUrl || def.defaultLoginUrl,
    email: input.email?.trim() ?? current?.email ?? "",
    useGoogleSso: input.useGoogleSso ?? current?.useGoogleSso ?? true,
    sessionReady: input.sessionReady ?? current?.sessionReady ?? false,
    notes: input.notes?.trim() ?? current?.notes ?? "",
    updatedAt: new Date().toISOString(),
  };

  setOfficeSecret(secretKey(slug), JSON.stringify(payload));

  return {
    platform: slug,
    label: def.label,
    loginUrl: payload.loginUrl,
    email: payload.email,
    passwordSet: false,
    useGoogleSso: payload.useGoogleSso,
    sessionReady: payload.sessionReady,
    notes: payload.notes,
    updatedAt: payload.updatedAt,
  };
}

export function markPlatformSession(slug: string, ready: boolean): JobPlatformCredential | null {
  const current = readStored(slug) ?? {
    loginUrl: defForSlug(slug)?.defaultLoginUrl ?? "",
    email: "",
    useGoogleSso: true,
    sessionReady: false,
    notes: "",
    updatedAt: new Date().toISOString(),
  };
  return savePlatformCredential(slug, {
    loginUrl: current.loginUrl,
    email: current.email,
    useGoogleSso: current.useGoogleSso,
    notes: current.notes,
    sessionReady: ready,
  });
}

export function deletePlatformCredential(slug: string): boolean {
  if (!defForSlug(slug)) return false;
  deleteOfficeSecret(secretKey(slug));
  return true;
}

export function platformSlugFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const map: Record<string, string> = {
      "linkedin.com": "linkedin",
      "welcometothejungle.com": "wttj",
      "indeed.com": "indeed",
      "indeed.fr": "indeed",
      "remoteok.com": "remoteok",
      "weworkremotely.com": "weworkremotely",
      "remotive.com": "remotive",
      "glassdoor.com": "glassdoor",
      "glassdoor.fr": "glassdoor",
    };
    for (const [domain, slug] of Object.entries(map)) {
      if (host === domain || host.endsWith(`.${domain}`)) return slug;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Plateformes où une session navigateur est fortement recommandée avant candidature. */
export function platformNeedsSession(slug: string | null): boolean {
  return slug === "linkedin" || slug === "wttj" || slug === "indeed" || slug === "glassdoor";
}

export function credentialHintForUrl(url: string): string {
  const slug = platformSlugFromUrl(url);
  if (!slug) {
    return "Utiliser le navigateur Job Hunt (profil persistant). Pas de mot de passe dans le prompt.";
  }
  const cred = getPlatformCredential(slug);
  const def = defForSlug(slug);
  if (cred?.sessionReady) {
    return `${def?.label}: session PC déjà connectée — réutiliser le profil navigateur Job Hunt (cookies). Ne jamais demander ni saisir de mot de passe.`;
  }
  if (cred?.useGoogleSso) {
    return `${def?.label}: session non marquée — si login requis, « Continuer avec Google » ; l'utilisateur se connecte lui-même sur le PC.`;
  }
  return `${def?.label}: ouvrir ${cred?.loginUrl || def?.defaultLoginUrl} dans le navigateur Job Hunt ; l'utilisateur se connecte manuellement.`;
}

/** Chemin profil Chrome/Chromium partagé (doc + prompts). */
export function jobHuntBrowserProfileHint(): string {
  return "~/.master-pc-agent/browser-profile";
}
