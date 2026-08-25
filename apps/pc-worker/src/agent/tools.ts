export type AgentAction =
  | { tool: "click"; x: number; y: number; button?: "left" | "right" | "middle"; reason?: string }
  | { tool: "type"; text: string; reason?: string }
  | { tool: "hotkey"; keys: string; reason?: string }
  | { tool: "scroll"; amount: number; reason?: string }
  | { tool: "shell"; command: string; reason?: string }
  | { tool: "open_app"; app: string; reason?: string }
  | { tool: "ask_user"; question: string; reason?: string }
  | { tool: "save_skill"; name: string; body: string; reason?: string }
  | { tool: "use_skill"; name: string; reason?: string }
  | { tool: "escalate_chatgpt"; prompt: string; reason?: string }
  | { tool: "wait"; ms?: number; reason?: string }
  | { tool: "screenshot"; reason?: string }
  | { tool: "done"; summary: string; reason?: string }
  | { tool: "model"; role: "fast" | "reason" | "vision"; reason?: string };

export function parseAgentAction(raw: string): AgentAction | null {
  const trimmed = raw.trim();
  // Extract first JSON object
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const tool = String(obj.tool ?? "");
    switch (tool) {
      case "click":
        return {
          tool: "click",
          x: Number(obj.x),
          y: Number(obj.y),
          button: (obj.button as "left" | "right" | "middle") || "left",
          reason: obj.reason ? String(obj.reason) : undefined,
        };
      case "type":
        return { tool: "type", text: String(obj.text ?? ""), reason: str(obj.reason) };
      case "hotkey":
        return { tool: "hotkey", keys: String(obj.keys ?? ""), reason: str(obj.reason) };
      case "scroll":
        return { tool: "scroll", amount: Number(obj.amount ?? 3), reason: str(obj.reason) };
      case "shell":
        return { tool: "shell", command: String(obj.command ?? ""), reason: str(obj.reason) };
      case "open_app":
        return { tool: "open_app", app: String(obj.app ?? ""), reason: str(obj.reason) };
      case "ask_user":
        return { tool: "ask_user", question: String(obj.question ?? ""), reason: str(obj.reason) };
      case "save_skill":
        return {
          tool: "save_skill",
          name: String(obj.name ?? "skill"),
          body: String(obj.body ?? ""),
          reason: str(obj.reason),
        };
      case "use_skill":
        return { tool: "use_skill", name: String(obj.name ?? ""), reason: str(obj.reason) };
      case "escalate_chatgpt":
        return {
          tool: "escalate_chatgpt",
          prompt: String(obj.prompt ?? ""),
          reason: str(obj.reason),
        };
      case "wait":
        return { tool: "wait", ms: Number(obj.ms ?? 1000), reason: str(obj.reason) };
      case "screenshot":
        return { tool: "screenshot", reason: str(obj.reason) };
      case "done":
        return { tool: "done", summary: String(obj.summary ?? "terminé"), reason: str(obj.reason) };
      case "model":
        return {
          tool: "model",
          role: (String(obj.role ?? "reason") as "fast" | "reason" | "vision") || "reason",
          reason: str(obj.reason),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function str(v: unknown): string | undefined {
  return v != null ? String(v) : undefined;
}

export const TOOL_SPEC = `Réponds UNIQUEMENT avec un JSON d'une action parmi:
{"tool":"click","x":100,"y":200,"button":"left","reason":"..."}
{"tool":"type","text":"...","reason":"..."}
{"tool":"hotkey","keys":"ctrl+l","reason":"..."}
{"tool":"scroll","amount":3,"reason":"..."}
{"tool":"shell","command":"date","reason":"..."}
{"tool":"open_app","app":"cursor|terminal|firefox|chatgpt","reason":"..."}
{"tool":"ask_user","question":"...","reason":"..."}
{"tool":"save_skill","name":"mon-skill","body":"markdown étapes","reason":"..."}
{"tool":"use_skill","name":"mon-skill","reason":"..."}
{"tool":"escalate_chatgpt","prompt":"question pour ChatGPT","reason":"..."}
{"tool":"wait","ms":1500,"reason":"..."}
{"tool":"screenshot","reason":"..."}
{"tool":"model","role":"fast|reason|vision","reason":"..."}
{"tool":"done","summary":"résultat final pour l'utilisateur","reason":"..."}

Règles:
- Agis comme un humain prudent sur le bureau Linux.
- Après une action UI, observe (prochaine itération aura un screenshot).
- Si tu manques d'info critique, ask_user.
- Si tu es bloqué après plusieurs essais, escalate_chatgpt.
- Quand la tâche est vraiment finie, done avec un résumé clair.
- Ne révèle jamais de secrets (.env, tokens, mots de passe).
- Une seule action JSON par réponse.`;
