/** Accusés + fit — copie côté sidecar (pas de monorepo partagé). */

export function interimAckText(ask: string): string {
  const t = ask.trim();
  if (/d[eé]l[eè]gue|spawn|subagent|manager|chef|mission/i.test(t)) {
    return "Compris — je délègue et je reviens avec la réponse finale.";
  }
  if (/cherche|search|scan|code|installe|install|fichier|browser|debug/i.test(t)) {
    return "OK, je m’en occupe. Réponse finale dans un instant.";
  }
  if (/\?/.test(t)) {
    return "Bien reçu, je regarde ça…";
  }
  return "Bien reçu, je traite ta demande…";
}

export type ReplyFit = { ok: boolean; note?: string };

export function assessReplyFit(ask: string, reply: string): ReplyFit {
  const q = ask.trim();
  const a = reply.trim();
  if (!a || a.length < 2) {
    return { ok: false, note: "Réponse vide — la demande n’a pas été traitée." };
  }
  if (/^L’agent n’a pas pu répondre|^Le modèle n’a pas|^Pas de réponse/i.test(a)) {
    return { ok: false, note: a };
  }
  const only = q.match(/uniquement\s*[:=]?\s*["“]?([A-Za-z0-9._-]+)["”]?/i);
  if (only?.[1] && !new RegExp(only[1], "i").test(a)) {
    return {
      ok: false,
      note: `La demande exigeait « ${only[1]} », la réponse ne le contient pas.`,
    };
  }
  const pong = q.match(/\b(pong|emp-?ok|mgr-?ready|emp2-?ok)\b/i);
  if (pong?.[1] && !new RegExp(pong[1].replace(/-/g, "-?"), "i").test(a)) {
    return {
      ok: false,
      note: `Mot attendu « ${pong[1]} » absent de la réponse.`,
    };
  }
  if (q.length > 20 && a.length < 8 && !/\b(ok|oui|non|pong|fait)\b/i.test(a)) {
    return { ok: false, note: "Réponse trop courte pour la demande." };
  }
  return { ok: true };
}
