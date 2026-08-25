/** Helpers pour scénarios veille produits / sentinelles (parsés depuis le chat). */

import { loadMailImapConfig } from "@/lib/db/office-secrets";

export type ProductWatchBrief = {
  product: string;
  maxPriceEur?: number;
  sites: string[];
  category?: string;
};

export type MonitorInterval = {
  minutes: number;
};

const SITE_ALIASES: Record<string, string> = {
  ebay: "ebay",
  "e-bay": "ebay",
  leboncoin: "leboncoin",
  lbc: "leboncoin",
  amazon: "amazon",
  vinted: "vinted",
  rakuten: "rakuten",
};

const KNOWN_SITES = Object.keys(SITE_ALIASES);

/** Extrait un intervalle de surveillance récurrente depuis un texte naturel. */
export function parseMonitorInterval(text: string): MonitorInterval | null {
  const raw = text.trim();
  if (!raw) return null;

  const everyMin = raw.match(
    /\b(?:toutes?\s+les?|chaque|every|tous?\s+les?)\s+(\d+)\s*(?:min(?:ute)?s?|mn)\b/i,
  );
  if (everyMin?.[1]) {
    const minutes = Number(everyMin[1]);
    return minutes > 0 && minutes <= 24 * 60 ? { minutes } : null;
  }

  const hourMatch = raw.match(
    /\b(?:toutes?\s+les?|chaque|every|tous?\s+les?)\s+(\d+)\s*h(?:eures?)?\b/i,
  );
  if (hourMatch?.[1]) {
    const minutes = Number(hourMatch[1]) * 60;
    return minutes > 0 && minutes <= 24 * 60 ? { minutes } : null;
  }

  if (/\b(?:toutes?\s+les?\s+heures?|chaque\s+heure|hourly)\b/i.test(raw)) {
    return { minutes: 60 };
  }

  return null;
}

function normalizeSite(token: string): string | null {
  const key = token.toLowerCase().replace(/\s+/g, "");
  return SITE_ALIASES[key] ?? null;
}

/** Extrait produit, seuil prix et sites depuis un brief de veille. */
export function parseProductWatchBrief(text: string): ProductWatchBrief | null {
  const raw = text.trim();
  if (
    !raw ||
    !/\b(surveill(?:e|er|ance)?|veill(?:e|er|ance)?|scan(?:ner)?|alerte|watch|cherche(?:r)?|recherche)\b/i.test(
      raw,
    )
  ) {
    return null;
  }

  const priceMatch =
    raw.match(/(?:<\s*|sous\s+|max(?:imum)?\s+|moins\s+de\s+)(\d{2,5})\s*(?:€|euros?)/i) ||
    raw.match(/(\d{2,5})\s*(?:€|euros?)\s*(?:max|maximum|ou\s+moins)/i);
  const maxPriceEur = priceMatch?.[1] ? Number(priceMatch[1]) : undefined;

  const productMatch =
    raw.match(/\b(RTX\s*\d{4}(?:\s*Ti)?|GTX\s*\d{4}|RX\s*\d{4})\b/i) ||
    raw.match(/\b(?:GPU|carte\s+graphique)\s+([A-Za-z0-9 \-]{2,40})/i) ||
    raw.match(/\bsurveill(?:e|er)\s+([A-Za-z0-9][\w\s\-]{2,40}?)(?:\s+(?:sur|sous|<|chaque|toutes?)|$)/i);
  const product = productMatch?.[1]?.trim().replace(/\s+/g, " ");
  if (!product) return null;

  const sites: string[] = [];
  for (const site of KNOWN_SITES) {
    if (new RegExp(`\\b${site.replace("-", "[- ]?")}\\b`, "i").test(raw)) {
      const norm = normalizeSite(site);
      if (norm && !sites.includes(norm)) sites.push(norm);
    }
  }

  const categoryMatch = raw.match(/\bcat[eé]gorie\s+([A-Za-z0-9 \-/]{2,60})/i);
  const category = categoryMatch?.[1]?.trim();

  return {
    product,
    maxPriceEur: maxPriceEur && maxPriceEur > 0 ? maxPriceEur : undefined,
    sites: sites.length > 0 ? sites : ["ebay"],
    category,
  };
}

export type SentinelValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** Valide qu'un projet récurrent peut servir de sentinelle veille produit. */
export function validateSentinelProject(input: {
  kind: "punctual" | "recurring";
  status: string;
  brief?: string;
  schedule?: string | null;
  nextRunAt?: string | null;
  meta?: Record<string, unknown>;
}): SentinelValidation {
  if (input.kind !== "recurring") {
    return { ok: false, reason: "sentinelle requiert kind=recurring" };
  }
  if (input.status !== "active" && input.status !== "paused") {
    return { ok: false, reason: "sentinelle requiert status active ou paused" };
  }

  const meta = input.meta ?? {};
  const watchType = meta.watchType ?? meta.type;
  const brief = (input.brief ?? "").trim();
  const hasWatchBrief =
    !!parseProductWatchBrief(brief) ||
    /\b(surveill|veill|sentinelle|alerte\s+prix)\b/i.test(brief);

  if (watchType !== "sentinel" && !hasWatchBrief) {
    return { ok: false, reason: "brief ou meta.watchType=sentinel requis" };
  }

  if (input.status === "active" && !input.nextRunAt && !input.schedule?.trim()) {
    return { ok: false, reason: "sentinelle active requiert nextRunAt ou schedule" };
  }

  return { ok: true };
}

/** Calcule le prochain next_run_at après un tick sentinelle. */
export function computeNextRunAt(fromIso: string, intervalMinutes: number): string {
  const base = new Date(fromIso);
  const next = new Date(base.getTime() + intervalMinutes * 60_000);
  return next.toISOString();
}

export type WatchSpeechIntent = {
  brief: ProductWatchBrief;
  interval: MonitorInterval;
  title: string;
  schedule: string;
};

/** Brief veille produit + intervalle depuis le chat (sans mot « projet »). */
export function parseWatchSpeechIntent(text: string): WatchSpeechIntent | null {
  const brief = parseProductWatchBrief(text);
  if (!brief) return null;
  const interval = parseMonitorInterval(text) ?? { minutes: 60 };
  const schedule =
    interval.minutes >= 60 && interval.minutes % 60 === 0
      ? `toutes les ${interval.minutes / 60}h`
      : `toutes les ${interval.minutes} min`;
  return {
    brief,
    interval,
    title: `Veille ${brief.product}`.slice(0, 160),
    schedule,
  };
}

export type MailBriefIntent = {
  action: "analyze" | "triage";
};

/** Intent analyse / tri boîte mail depuis le chat. */
export function parseMailBriefIntent(text: string): MailBriefIntent | null {
  const raw = text.trim();
  if (!raw) return null;
  if (!/\b(?:mail|mails?|bo[iî]te(?:\s+mail)?|inbox|courriel|e-?mail)\b/i.test(raw)) return null;
  if (
    !/\b(?:analys(?:e|er)|trie(?:r)?|tri(?:er|age)?|lire|lise|v[eé]rif(?:ie|ier)?|scanner?|check|regarde)\b/i.test(
      raw,
    )
  ) {
    return null;
  }
  return { action: /\btri(?:e|er|age)?\b/i.test(raw) ? "triage" : "analyze" };
}

/** IMAP branché : env OU config SQLite chiffrée. */
export function isMailConnected(): boolean {
  if (process.env.MAIL_IMAP_HOST?.trim() && process.env.MAIL_IMAP_USER?.trim() && process.env.MAIL_IMAP_PASS?.trim()) {
    return true;
  }
  try {
    const cfg = loadMailImapConfig();
    return Boolean(cfg?.host && cfg.user && cfg.pass);
  } catch {
    return Boolean(process.env.MAIL_IMAP_HOST?.trim());
  }
}

/** Intervalle minutes stocké en meta ou parsé depuis schedule/brief. */
export function resolveSentinelIntervalMinutes(project: {
  schedule?: string | null;
  brief?: string;
  meta?: Record<string, unknown>;
}): number {
  const fromMeta = project.meta?.intervalMinutes;
  if (typeof fromMeta === "number" && fromMeta > 0) return fromMeta;
  const parsed =
    parseMonitorInterval(project.schedule ?? "") ?? parseMonitorInterval(project.brief ?? "");
  return parsed?.minutes ?? 60;
}
