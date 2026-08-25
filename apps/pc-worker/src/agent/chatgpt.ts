import type { AgentConfig } from "./config.js";
import { audit } from "./audit.js";
import { hotkey, openApp, typeText } from "./input.js";
import { captureScreen } from "../screen.js";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Escalate to ChatGPT via browser UI (logged-in account).
 */
export async function escalateChatGPT(
  cfg: AgentConfig,
  prompt: string,
): Promise<{ ok: boolean; text: string; screenshotBase64?: string }> {
  const safePrompt = sanitizeForChatGpt(prompt);
  audit(cfg, "escalate_chatgpt", { prompt: safePrompt.slice(0, 200) });

  try {
    await openApp(cfg, "chatgpt");
    await sleep(3500);
    await hotkey(cfg, "ctrl+l");
    await sleep(400);
    await typeText(cfg, cfg.chatgptUrl);
    await hotkey(cfg, "Return");
    await sleep(4000);
    await typeText(cfg, safePrompt);
    await sleep(500);
    await hotkey(cfg, "Return");
    await sleep(8000);
    const shot = await captureScreen("chatgpt-escalate");
    return {
      ok: true,
      text: "Prompt envoyé à ChatGPT (UI). Lis la réponse sur le screenshot.",
      screenshotBase64: shot.base64,
    };
  } catch (err) {
    return {
      ok: false,
      text: `Escalade ChatGPT échouée: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function sanitizeForChatGpt(prompt: string): string {
  return prompt
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/crsr_[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 6000);
}
