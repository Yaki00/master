const TOKEN_TTL_MS = 55 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;

function apiBase(): string {
  return (
    process.env.PIXELBRAIN_API_URL?.replace(/\/$/, "") ??
    "https://api.card.pixelbrain.fr/api"
  );
}

async function getPlatformToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const email = process.env.PIXELBRAIN_PLATFORM_EMAIL;
  const password = process.env.PIXELBRAIN_PLATFORM_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "PIXELBRAIN_PLATFORM_EMAIL et PIXELBRAIN_PLATFORM_PASSWORD requis.",
    );
  }

  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Connexion API PixelbrainCard échouée (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { accessToken?: string };
  if (!data.accessToken) {
    throw new Error("Token plateforme absent dans la réponse login.");
  }

  cachedToken = {
    token: data.accessToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return data.accessToken;
}

export async function pixelbrainSupportFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const token = await getPlatformToken();
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text || res.statusText };
    }

    if (res.status === 204) {
      return { ok: true, data: null as T };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}
