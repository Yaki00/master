/**
 * Sync secrets mail vers Infisical (optionnel).
 * Requiert INFISICAL_SITE_URL + UNIVERSAL_AUTH client id/secret + project/env.
 */

type InfisicalToken = { accessToken: string; expiresAt: number };

let cachedToken: InfisicalToken | null = null;

function siteUrl(): string {
  return (process.env.INFISICAL_SITE_URL || "https://secrets.pixelbrain.fr").replace(/\/$/, "");
}

export function isInfisicalConfigured(): boolean {
  return Boolean(
    process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID?.trim() &&
      process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET?.trim() &&
      process.env.INFISICAL_PROJECT_ID?.trim() &&
      process.env.INFISICAL_ENV_SLUG?.trim(),
  );
}

async function getAccessToken(): Promise<string | null> {
  if (!isInfisicalConfigured()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;
  const res = await fetch(`${siteUrl()}/api/v1/auth/universal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID,
      clientSecret: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { accessToken?: string; expiresIn?: number };
  if (!json.accessToken) return null;
  cachedToken = {
    accessToken: json.accessToken,
    expiresAt: Date.now() + Math.max(60, Number(json.expiresIn ?? 800)) * 1000,
  };
  return cachedToken.accessToken;
}

async function upsertSecret(token: string, secretName: string, secretValue: string): Promise<boolean> {
  const projectId = process.env.INFISICAL_PROJECT_ID!;
  const environmentSlug = process.env.INFISICAL_ENV_SLUG!;
  const secretPath = process.env.INFISICAL_SECRET_PATH || "/";
  const base = `${siteUrl()}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`;
  const body = {
    workspaceId: projectId,
    environment: environmentSlug,
    secretPath,
    secretValue,
    type: "shared",
  };
  // Try update then create
  const upd = await fetch(base, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (upd.ok) return true;
  const cre = await fetch(`${siteUrl()}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, secretKey: secretName }),
  });
  return cre.ok;
}

export async function syncMailSecretsToInfisical(cfg: {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}): Promise<{ ok: boolean; detail: string }> {
  if (!isInfisicalConfigured()) {
    return { ok: false, detail: "Infisical non configuré (secrets locaux SQLite uniquement)." };
  }
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, detail: "Auth Infisical échouée." };
    const pairs: Array<[string, string]> = [
      ["MAIL_IMAP_HOST", cfg.host],
      ["MAIL_IMAP_PORT", String(cfg.port)],
      ["MAIL_IMAP_USER", cfg.user],
      ["MAIL_IMAP_PASS", cfg.pass],
      ["MAIL_IMAP_SECURE", cfg.secure ? "1" : "0"],
    ];
    for (const [k, v] of pairs) {
      const ok = await upsertSecret(token, k, v);
      if (!ok) return { ok: false, detail: `Échec écriture secret ${k}` };
    }
    return { ok: true, detail: "Secrets mail synchronisés Infisical." };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
