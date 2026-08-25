import { describe, expect, it } from "vitest";
import { assessReplyFit, interimAckText } from "./interim";

describe("interimAckText", () => {
  it("accusé immédiat selon le type de demande", () => {
    expect(interimAckText("délègue à main")).toMatch(/délègue/i);
    expect(interimAckText("scan ebay")).toMatch(/m’en occupe|m'en occupe/i);
    expect(interimAckText("tu fais quoi ?")).toMatch(/regarde|reçu/i);
  });
});

describe("assessReplyFit", () => {
  it("valide une réponse alignée", () => {
    expect(assessReplyFit("dis uniquement: pong", "pong")).toEqual({ ok: true });
    expect(assessReplyFit("salut", "Salut, je suis la réception.")).toEqual({ ok: true });
  });

  it("détecte hors-sujet / vide", () => {
    expect(assessReplyFit("dis uniquement: pong", "bonjour").ok).toBe(false);
    expect(assessReplyFit("une question longue sur le status", "hm").ok).toBe(false);
    expect(assessReplyFit("ping", "").ok).toBe(false);
  });
});
