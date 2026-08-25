import { describe, expect, it } from "vitest";
import { extractReplyText, humanizeOpenclawFailure, looksLikeOpenclawFailure } from "./reply";

describe("extractReplyText", () => {
  it("extrait payloads[].text (OpenClaw --json)", () => {
    expect(extractReplyText(JSON.stringify({ payloads: [{ text: "C’est fait." }] }))).toBe("C’est fait.");
  });

  it("extrait content[] type text", () => {
    expect(
      extractReplyText(
        JSON.stringify({
          message: { role: "assistant", content: [{ type: "text", text: "Voici le résumé." }] },
        }),
      ),
    ).toBe("Voici le résumé.");
  });

  it("extrait le dernier message assistant", () => {
    expect(
      extractReplyText(
        JSON.stringify({
          messages: [
            { role: "user", content: "ping" },
            { role: "assistant", content: "pong" },
          ],
        }),
      ),
    ).toBe("pong");
  });

  it("JSON collé après du bruit stdout", () => {
    const raw = `npm warn skip this\n{"text":"ok nettoyé"}\n`;
    expect(extractReplyText(raw)).toBe("ok nettoyé");
  });

  it("texte brut inchangé (sauts de ligne gardés)", () => {
    expect(extractReplyText("ligne 1\nligne 2")).toBe("ligne 1\nligne 2");
  });

  it("JSON sans texte utile → vide (pas un dump)", () => {
    expect(extractReplyText(JSON.stringify({ ok: true, status: "done" }))).toBe("");
  });

  it("vide / null", () => {
    expect(extractReplyText("")).toBe("");
    expect(extractReplyText(null)).toBe("");
  });

  it("détecte un timeout provider OpenClaw", () => {
    const raw = JSON.stringify({
      status: "timeout",
      timeoutPhase: "provider",
      result: { payloads: [{ text: "LLM request failed: network connection error." }] },
    });
    expect(looksLikeOpenclawFailure(raw)).toBe(true);
    expect(humanizeOpenclawFailure(raw)).toMatch(/erreur réseau/i);
  });
});
