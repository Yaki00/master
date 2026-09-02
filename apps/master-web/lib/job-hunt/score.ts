import type { JobHuntProfile } from "./types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ");
}

/** Score 0–100 based on stack overlap, remote signals, and region hints. */
export function scoreListing(
  listing: { title: string; description: string; tags: string[]; location: string; remoteType: string },
  profile: JobHuntProfile,
): number {
  const haystack = normalize(
    [listing.title, listing.description, listing.location, listing.remoteType, ...listing.tags].join(" "),
  );
  let score = 0;

  const stack = profile.stack.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (stack.length === 0) score += 20;
  else {
    let hits = 0;
    for (const skill of stack) {
      if (haystack.includes(skill)) hits += 1;
    }
    score += Math.round((hits / stack.length) * 50);
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
      if (tokens.some((t) => haystack.includes(t))) roleHits += 1;
    }
    score += Math.round((roleHits / roles.length) * 15);
  }

  return Math.max(0, Math.min(100, score));
}
