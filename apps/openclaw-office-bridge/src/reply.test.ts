import { describe, expect, it } from "vitest";
import { extractReplyText, interpretOpenclawOutput } from "./reply";

describe("extractReplyText", () => {
  it("extrait payloads[].text", () => {
    expect(extractReplyText('{"payloads":[{"text":"C’est fait."}]}')).toBe("C’est fait.");
  });

  it("JSON sans texte → vide", () => {
    expect(extractReplyText('{"ok":true}')).toBe("");
  });

  it("texte brut", () => {
    expect(extractReplyText("ok")).toBe("ok");
  });

  it("timeout provider → échec lisible, pas un faux done", () => {
    const raw = JSON.stringify({
      status: "timeout",
      summary: "aborted",
      timeoutPhase: "provider",
      result: {
        payloads: [{ text: "LLM request failed: network connection error." }],
        meta: { livenessState: "blocked", finalAssistantVisibleText: "[assistant turn failed before producing content]" },
      },
    });
    const out = interpretOpenclawOutput(raw);
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/erreur réseau/i);
  });
});
