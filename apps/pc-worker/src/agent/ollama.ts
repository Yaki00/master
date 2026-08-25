import type { AgentConfig, ModelRole } from "./config.js";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: string }>;
};

export async function ollamaTags(cfg: AgentConfig): Promise<string[]> {
  try {
    const res = await fetch(`${cfg.ollamaBase}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export function pickModel(
  cfg: AgentConfig,
  role: ModelRole,
  installed: string[],
  failures: number,
): string {
  const preferred = cfg.models[role];
  const order: ModelRole[] =
    failures >= 2 ? ["reason", "vision", "fast"] : role === "vision" ? ["vision", "reason", "fast"] : [role, "reason", "fast"];

  for (const r of order) {
    const name = cfg.models[r];
    if (installed.some((m) => m === name || m.startsWith(name.split(":")[0]!))) return name;
  }
  if (installed.length) return installed[0]!;
  return preferred;
}

/** Text chat; optional image base64 (no data: prefix) for vision models. */
export async function ollamaChat(
  cfg: AgentConfig,
  opts: {
    model: string;
    system: string;
    user: string;
    imageBase64?: string;
    temperature?: number;
  },
): Promise<string> {
  const messages: Array<Record<string, unknown>> = [{ role: "system", content: opts.system }];

  if (opts.imageBase64) {
    messages.push({
      role: "user",
      content: opts.user,
      images: [opts.imageBase64],
    });
  } else {
    messages.push({ role: "user", content: opts.user });
  }

  const res = await fetch(`${cfg.ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      options: { temperature: opts.temperature ?? 0.2, num_predict: 400 },
      messages,
    }),
    signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS ?? "120000")),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 400)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return (data.message?.content ?? "").trim();
}
