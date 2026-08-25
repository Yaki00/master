/** Extraire un texte de réponse lisible depuis stdout CLI / JSON OpenClaw. */

const PREFERRED_KEYS = [
  "text",
  "message",
  "content",
  "reply",
  "output",
  "result",
  "answer",
  "resultText",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const rec = asRecord(item);
      if (rec && (rec.type === "text" || typeof rec.text === "string")) {
        const t = textFromUnknown(rec.text ?? rec, depth + 1);
        if (t) parts.push(t);
        continue;
      }
      const t = textFromUnknown(item, depth + 1);
      if (t) parts.push(t);
    }
    const joined = parts.join("\n").trim();
    return joined || null;
  }
  const rec = asRecord(value);
  if (!rec) return null;

  const role = String(rec.role ?? rec.type ?? "");
  if (role === "tool" || role === "tool_result" || role === "function") return null;

  for (const key of PREFERRED_KEYS) {
    if (rec[key] == null) continue;
    const t = textFromUnknown(rec[key], depth + 1);
    if (t) return t;
  }

  if (Array.isArray(rec.payloads)) {
    const t = textFromUnknown(rec.payloads, depth + 1);
    if (t) return t;
  }
  if (Array.isArray(rec.choices)) {
    const choice = rec.choices[rec.choices.length - 1];
    const t = textFromUnknown(choice, depth + 1);
    if (t) return t;
  }
  if (Array.isArray(rec.messages)) {
    for (let i = rec.messages.length - 1; i >= 0; i--) {
      const msg = rec.messages[i];
      const m = asRecord(msg);
      const r = String(m?.role ?? "");
      if (r && r !== "assistant" && r !== "agent") continue;
      const t = textFromUnknown(msg, depth + 1);
      if (t) return t;
    }
  }
  return null;
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  const a = trimmed.indexOf("[");
  const b = trimmed.lastIndexOf("]");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(trimmed.slice(a, b + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const NOISE_LINE =
  /^(npm warn|attention:|\[office-bridge\]|debugger listening|experimentalwarning)/i;

const FAIL_STATUSES = new Set(["timeout", "error", "failed", "aborted"]);

function runMeta(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const nested = asRecord(parsed.result);
  const meta = asRecord(nested?.meta) ?? asRecord(parsed.meta);
  return meta;
}

/** JSON CLI OpenClaw : timeout provider / tour aborté / erreur LLM. */
export function looksLikeOpenclawFailure(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const parsed = tryParseJson(raw);
  const rec = asRecord(parsed);
  if (rec) {
    const status = String(rec.status ?? rec.summary ?? rec.stopReason ?? "").toLowerCase();
    if (FAIL_STATUSES.has(status)) return true;
    if (rec.timeoutPhase != null) return true;
    const meta = runMeta(rec);
    if (meta && String(meta.livenessState ?? "") === "blocked") return true;
    const vis = String(meta?.finalAssistantVisibleText ?? rec.finalAssistantVisibleText ?? "");
    if (/failed before producing/i.test(vis)) return true;
  }
  return /LLM request failed|assistant turn failed|model idle timeout|Control UI did not start|Command failed:\s*openclaw/i.test(
    raw,
  );
}

export function humanizeOpenclawFailure(raw: string | null | undefined): string {
  const blob = raw ?? "";
  if (/Command failed:\s*openclaw/i.test(blob)) {
    return "L’agent n’a pas pu répondre. Réessaie.";
  }
  if (/network connection error/i.test(blob)) {
    return "Le modèle n’a pas répondu (erreur réseau). Réessaie.";
  }
  if (/Control UI did not start/i.test(blob)) {
    return "OpenClaw n’est pas joignable sur le Mac.";
  }
  if (/idle timeout|timeoutPhase|"status"\s*:\s*"timeout"/i.test(blob)) {
    return "Le modèle a mis trop de temps à répondre. Réessaie.";
  }
  const extracted = extractReplyText(blob);
  const first = extracted.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (first && first.length < 280 && !/systemPromptReport|schemaHash/.test(first)) {
    return first;
  }
  return "L’agent n’a pas pu répondre. Réessaie.";
}

export function extractReplyText(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const parsed = tryParseJson(trimmed);
  if (parsed != null) {
    const fromJson = textFromUnknown(parsed);
    if (fromJson) return fromJson.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !NOISE_LINE.test(l.trim()));
  return lines.join("\n").trim();
}
