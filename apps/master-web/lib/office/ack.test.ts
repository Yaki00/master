import { describe, expect, it } from "vitest";
import { eventFromCommandAck, normalizeOfficeAck } from "./ack";

describe("eventFromCommandAck", () => {
  it("message done → agent_message avec texte JSON parsé", () => {
    const ev = eventFromCommandAck(
      { id: "c1", kind: "message" },
      "done",
      JSON.stringify({ payloads: [{ text: "Réponse claire." }] }),
    );
    expect(ev).toEqual({
      kind: "agent_message",
      payload: expect.objectContaining({ text: "Réponse claire.", role: "agent" }),
    });
  });

  it("pause/stop done → pas d’événement chat", () => {
    expect(eventFromCommandAck({ id: "p", kind: "pause" }, "done", "best-effort pause")).toBeNull();
    expect(eventFromCommandAck({ id: "s", kind: "stop" }, "done", "best-effort stop")).toBeNull();
  });

  it("failed → command_failed", () => {
    const ev = eventFromCommandAck({ id: "c", kind: "message" }, "failed", "timeout 90s");
    expect(ev?.kind).toBe("command_failed");
    expect(ev?.payload.text).toBe("timeout 90s");
  });

  it("done sans texte → null", () => {
    expect(eventFromCommandAck({ id: "c", kind: "message" }, "done", '{"ok":true}')).toBeNull();
  });

  it("timeout JSON OpenClaw → failed humanisé", () => {
    const raw = JSON.stringify({
      status: "timeout",
      summary: "aborted",
      timeoutPhase: "provider",
      result: {
        payloads: [{ text: "LLM request failed: network connection error." }],
      },
    });
    const norm = normalizeOfficeAck("done", raw);
    expect(norm.status).toBe("failed");
    expect(norm.result).toMatch(/erreur réseau/i);
  });
});
