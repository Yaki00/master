/** Stripe MRR par app — subscriptions actives filtrées par metadata.app_id */

export type StripeAppRevenue = {
  mrrCents: number | null;
  activeSubscriptions: number | null;
  source: "stripe" | "unavailable";
};

type StripeSub = {
  id: string;
  status: string;
  items?: {
    data?: {
      price?: {
        unit_amount?: number | null;
        recurring?: { interval?: string; interval_count?: number } | null;
        metadata?: Record<string, string>;
        product?: string | { metadata?: Record<string, string> };
      };
      quantity?: number;
    }[];
  };
  metadata?: Record<string, string>;
};

function toMonthlyCents(unitAmount: number, interval?: string, intervalCount = 1, quantity = 1): number {
  const q = Math.max(1, quantity);
  const count = Math.max(1, intervalCount);
  const total = unitAmount * q;
  if (interval === "year") return Math.round(total / (12 * count));
  if (interval === "week") return Math.round((total * 52) / (12 * count));
  if (interval === "day") return Math.round((total * 365) / (12 * count));
  // month (default)
  return Math.round(total / count);
}

function matchesApp(sub: StripeSub, appId: string): boolean {
  if (sub.metadata?.app_id === appId) return true;
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    if (!price) continue;
    if (price.metadata?.app_id === appId) return true;
    const product = price.product;
    if (product && typeof product === "object" && product.metadata?.app_id === appId) return true;
  }
  // PixelbrainCard = app Stripe par défaut si pas de metadata app_id
  if (appId === "pixelbraincard") {
    const hasAppMeta =
      Boolean(sub.metadata?.app_id) ||
      (sub.items?.data ?? []).some(
        (item) =>
          item.price?.metadata?.app_id ||
          (item.price?.product &&
            typeof item.price.product === "object" &&
            item.price.product.metadata?.app_id),
      );
    if (!hasAppMeta) return true;
  }
  return false;
}

async function listActiveSubscriptions(stripeKey: string): Promise<StripeSub[]> {
  const out: StripeSub[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      limit: "100",
      status: "active",
      "expand[]": "data.items.data.price",
    });
    // Also include trialing
    if (startingAfter) params.set("starting_after", startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[stripe] list subscriptions failed", res.status, await res.text());
      break;
    }
    const json = (await res.json()) as { data: StripeSub[]; has_more?: boolean };
    out.push(...(json.data ?? []));
    if (!json.has_more || !json.data?.length) break;
    startingAfter = json.data[json.data.length - 1]?.id;
  }

  // Trialing (second pass)
  startingAfter = undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      limit: "100",
      status: "trialing",
      "expand[]": "data.items.data.price",
    });
    if (startingAfter) params.set("starting_after", startingAfter);
    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) break;
    const json = (await res.json()) as { data: StripeSub[]; has_more?: boolean };
    out.push(...(json.data ?? []));
    if (!json.has_more || !json.data?.length) break;
    startingAfter = json.data[json.data.length - 1]?.id;
  }

  return out;
}

let cache: { at: number; subs: StripeSub[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

async function getCachedSubs(stripeKey: string): Promise<StripeSub[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.subs;
  const subs = await listActiveSubscriptions(stripeKey);
  cache = { at: Date.now(), subs };
  return subs;
}

export async function fetchStripeMrrByApp(appId: string): Promise<StripeAppRevenue> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { mrrCents: null, activeSubscriptions: null, source: "unavailable" };
  }

  try {
    const subs = await getCachedSubs(stripeKey);
    const matched = subs.filter((s) => matchesApp(s, appId));
    let mrr = 0;
    for (const sub of matched) {
      for (const item of sub.items?.data ?? []) {
        const price = item.price;
        if (!price?.unit_amount) continue;
        mrr += toMonthlyCents(
          price.unit_amount,
          price.recurring?.interval,
          price.recurring?.interval_count ?? 1,
          item.quantity ?? 1,
        );
      }
    }
    return {
      mrrCents: matched.length ? mrr : null,
      activeSubscriptions: matched.length || null,
      source: "stripe",
    };
  } catch (err) {
    console.error("[stripe] MRR error", err);
    return { mrrCents: null, activeSubscriptions: null, source: "unavailable" };
  }
}

export async function fetchTotalMrrCents(): Promise<{ total: number | null; source: string }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { total: null, source: "unavailable" };
  try {
    const subs = await getCachedSubs(stripeKey);
    let total = 0;
    for (const sub of subs) {
      for (const item of sub.items?.data ?? []) {
        const price = item.price;
        if (!price?.unit_amount) continue;
        total += toMonthlyCents(
          price.unit_amount,
          price.recurring?.interval,
          price.recurring?.interval_count ?? 1,
          item.quantity ?? 1,
        );
      }
    }
    return { total, source: "stripe" };
  } catch {
    return { total: null, source: "unavailable" };
  }
}
