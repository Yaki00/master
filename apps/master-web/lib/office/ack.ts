import type { OfficeCommand } from "./types";
import { extractReplyText, humanizeOpenclawFailure, looksLikeOpenclawFailure } from "./reply";

export function normalizeOfficeAck(
  status: "done" | "failed",
  result: string | null,
): { status: "done" | "failed"; result: string } {
  const raw = result ?? "";
  if (status === "failed" || looksLikeOpenclawFailure(raw)) {
    return { status: "failed", result: humanizeOpenclawFailure(raw) || raw || "échec" };
  }
  return { status: "done", result: extractReplyText(raw) };
}

export type AckEvent = {
  kind: "agent_message" | "command_failed";
  payload: Record<string, unknown>;
};

/** Pause/stop ne sont pas des réponses. Message/resume → bulle agent. */
export function eventFromCommandAck(
  command: Pick<OfficeCommand, "id" | "kind">,
  status: "done" | "failed",
  result: string | null,
): AckEvent | null {
  const text = extractReplyText(result ?? "");

  if (status === "failed") {
    return {
      kind: "command_failed",
      payload: {
        commandId: command.id,
        kind: command.kind,
        text: text || "échec",
        role: "system",
      },
    };
  }

  if (command.kind === "pause" || command.kind === "stop") return null;
  if (!text) return null;

  return {
    kind: "agent_message",
    payload: {
      commandId: command.id,
      kind: command.kind,
      text,
      role: "agent",
    },
  };
}
