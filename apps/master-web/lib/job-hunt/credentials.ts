import { deleteOfficeSecret, getOfficeSecret, setOfficeSecret } from "@/lib/db/office-secrets";
import { JOB_PLATFORM_DEFS, type JobPlatformCredential, type JobPlatformCredentialInput } from "./types";

const PREFIX = "job_hunt_platform:";

type StoredCredential = {
  loginUrl: string;
  email: string;
  password: string;
  useGoogleSso: boolean;
  notes: string;
  updatedAt: string;
};

function secretKey(slug: string): string {
  return `${PREFIX}${slug}`;
}

function defForSlug(slug: string) {
  return JOB_PLATFORM_DEFS.find((d) => d.slug === slug);
}

export function listPlatformCredentials(): JobPlatformCredential[] {
  return JOB_PLATFORM_DEFS.map((def) => {
    const stored = readStored(def.slug);
    return {
      platform: def.slug,
      label: def.label,
      loginUrl: stored?.loginUrl || def.defaultLoginUrl,
      email: stored?.email ?? "",
      passwordSet: Boolean(stored?.password),
      useGoogleSso: stored?.useGoogleSso ?? true,
      notes: stored?.notes ?? "",
      updatedAt: stored?.updatedAt ?? null,
    };
  });
}

function readStored(slug: string): StoredCredential | null {
  const raw = getOfficeSecret(secretKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

export function getPlatformCredential(slug: string): StoredCredential | null {
  return readStored(slug);
}

export function savePlatformCredential(
  slug: string,
  input: JobPlatformCredentialInput & { password?: string },
): JobPlatformCredential | null {
  const def = defForSlug(slug);
  if (!def) return null;

  const current = readStored(slug);
  const password =
    input.password !== undefined && input.password !== "" ? input.password : (current?.password ?? "");

  const payload: StoredCredential = {
    loginUrl: input.loginUrl?.trim() || def.defaultLoginUrl,
    email: input.email?.trim() ?? "",
    password,
    useGoogleSso: input.useGoogleSso ?? current?.useGoogleSso ?? true,
    notes: input.notes?.trim() ?? "",
    updatedAt: new Date().toISOString(),
  };

  setOfficeSecret(secretKey(slug), JSON.stringify(payload));

  return {
    platform: slug,
    label: def.label,
    loginUrl: payload.loginUrl,
    email: payload.email,
    passwordSet: Boolean(payload.password),
    useGoogleSso: payload.useGoogleSso,
    notes: payload.notes,
    updatedAt: payload.updatedAt,
  };
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
    };
    for (const [domain, slug] of Object.entries(map)) {
      if (host === domain || host.endsWith(`.${domain}`)) return slug;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function credentialHintForUrl(url: string): string {
  const slug = platformSlugFromUrl(url);
  if (!slug) return "Connexion via Google Password Manager si possible.";
  const cred = getPlatformCredential(slug);
  const def = defForSlug(slug);
  if (!cred) return `Plateforme ${def?.label ?? slug}: Google SSO par défaut.`;
  if (cred.useGoogleSso) {
    return `${def?.label}: utiliser « Continuer avec Google » (email: ${cred.email || "compte Google"}).`;
  }
  return `${def?.label}: login ${cred.loginUrl} — email ${cred.email} (mot de passe enregistré dans Master).`;
}
