import type { JobHuntProfile } from "./types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ");
}

const MARKETPLACE_RE =
  /\b(lemon\.io|toptal|turing\.com|andela|arc\.dev|gun\.io|hired\.com|coterminal)\b/i;

const TAG_SOUP_THRESHOLD = 18;

/** Score 0–100 based on stack overlap, remote signals, and region hints. */
export function scoreListing(
  listing: {
    title: string;
    company?: string;
    description: string;
    tags: string[];
    location: string;
    remoteType: string;
  },
  profile: JobHuntProfile,
): number {
  const company = String(listing.company ?? "");
  const tags = listing.tags ?? [];
  const haystack = normalize(
    [listing.title, listing.description, listing.location, listing.remoteType, company, ...tags].join(
      " ",
    ),
  );
  let score = 0;

  const stack = profile.stack.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (stack.length === 0) score += 20;
  else {
    // Compétences : titre + description pèsent plus que les tags (anti tag-soup Lemon.io)
    const titleDesc = normalize([listing.title, listing.description].join(" "));
    let strongHits = 0;
    let weakHits = 0;
    for (const skill of stack) {
      if (titleDesc.includes(skill)) strongHits += 1;
      else if (haystack.includes(skill)) weakHits += 1;
    }
    const weighted = strongHits + weakHits * 0.35;
    score += Math.round((weighted / stack.length) * 50);
  }

  if (profile.remoteOnly) {
    if (/remote|télétravail|teletravail|anywhere|worldwide|distributed/.test(haystack)) score += 25;
    else if (/hybrid|on-?site|office/.test(haystack)) score -= 15;
    else score += 10;
  } else {
    score += 15;
  }

  const regions = profile.preferredRegions.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (regions.length === 0) score += 10;
  else if (regions.some((r) => haystack.includes(r))) score += 15;
  else score += 5;

  if (/senior|lead|staff|principal/.test(haystack)) score += 5;
  if (/full.?stack|backend|frontend|devops|software engineer|developer|développeur/.test(haystack)) {
    score += 5;
  }

  const roles = profile.targetRoles.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (roles.length > 0) {
    let roleHits = 0;
    for (const role of roles) {
      const tokens = role.split(/\s+/).filter((t) => t.length > 3);
      // Rôle : privilégier le titre
      const titleN = normalize(listing.title);
      if (tokens.some((t) => titleN.includes(t))) roleHits += 1;
      else if (tokens.some((t) => haystack.includes(t))) roleHits += 0.4;
    }
    score += Math.round((roleHits / roles.length) * 15);
  }

  // Marketplace / agences : souvent multi-offres + tags fourre-tout
  if (MARKETPLACE_RE.test(company) || MARKETPLACE_RE.test(listing.description)) {
    score -= 18;
  }
  if (tags.length >= TAG_SOUP_THRESHOLD) {
    score -= Math.min(25, 8 + (tags.length - TAG_SOUP_THRESHOLD));
  }
  // Annonce « NOT YOUR TECH STACK » / catalogue de métiers
  if (/not your tech stack|we'?re placing senior|multiple .+ openings/i.test(listing.description)) {
    score -= 12;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
