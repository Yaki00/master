import type { AgentConfig, ModelRole } from "./config.js";
import { audit } from "./audit.js";
import { escalateChatGPT } from "./chatgpt.js";
import {
  hotkey,
  mouseClick,
  openApp,
  runSafeShell,
  scroll,
  typeText,
} from "./input.js";
import { ollamaChat, ollamaTags, pickModel } from "./ollama.js";
import { loadSkill, saveSkill, skillsContext } from "./skills.js";
import { parseAgentAction, TOOL_SPEC, type AgentAction } from "./tools.js";
import { captureScreen } from "../screen.js";

export type AgentRunResult = {
  status: "completed" | "failed" | "paused";
  text: string;
  mediaBase64?: string;
};

type ProgressFn = (message: string) => Promise<void>;

export async function runPcAgent(opts: {
  cfg: AgentConfig;
  goal: string;
  progress: ProgressFn;
}): Promise<AgentRunResult> {
  const { cfg, goal, progress } = opts;
  const started = Date.now();
  const deadline = started + cfg.maxMinutes * 60_000;
  let failures = 0;
  let role: ModelRole = "reason";
  let lastShot: string | undefined;
  let lastObservation = "";
  const history: string[] = [];
  let skillHint = "";

  const installed = await ollamaTags(cfg);
  if (!installed.length) {
    return {
      status: "failed",
      text: "Ollama inaccessible ou aucun modèle. Sur le PC: curl -fsSL https://ollama.com/install.sh | sh && ollama pull llava && ollama pull qwen2.5:7b",
    };
  }

  await progress(`Agent démarré (${installed.length} modèles Ollama)`);

  const goalLower = goal.toLowerCase();

  // Fast-path: heure / date en langage naturel
  if (
    /\b(quelle\s+heure|what\s+time|heure\s+est|l['']heure)\b/i.test(goal) ||
    /^\s*date\s*[?.!]?\s*$/i.test(goal)
  ) {
    const r = await runSafeShell(cfg, "date");
    audit(cfg, "shell_fastpath", { cmd: "date", ok: r.ok, reason: "time_nl" });
    if (r.ok) return { status: "completed", text: r.text.trim().slice(0, 3500) };
    lastObservation = r.text;
  }

  // Fast-path: consignes shell explicites (évite LLM qui boucle sur ask_user)
  const shellDirect = goal.match(
    /(?:shell\s*:?\s*|exécute(?:r)?\s+(?:la\s+)?commande\s+(?:shell\s+)?|execute(?:\s+the)?\s+shell\s+command\s+)([a-z0-9_./\s-]{1,80})/i,
  );
  if (shellDirect) {
    let cmd = shellDirect[1]!.trim().split(/\n/)[0]!.trim();
    cmd = cmd.replace(/\s+(et|and|puis|then|now|maintenant).*$/i, "").trim();
    if (/^date\b/i.test(goal) || cmd.toLowerCase().startsWith("date")) cmd = "date";
    const r = await runSafeShell(cfg, cmd);
    audit(cfg, "shell_fastpath", { cmd, ok: r.ok });
    if (r.ok) {
      return { status: "completed", text: r.text.slice(0, 3500) };
    }
    lastObservation = r.text;
  }

  // UI seulement si mots-clés UI — sinon modèle fast sans screenshot
  const uiLikely = /\b(écran|screen|souris|clavier|cursor|fenêtre|click|clique|ouvre|chrome|firefox|chatgpt|bureau|ui|fenetre)\b/i.test(
    goalLower,
  );
  if (!uiLikely) {
    role = "fast";
  }

  for (let step = 1; step <= cfg.maxSteps; step++) {
    if (Date.now() > deadline) {
      return {
        status: "failed",
        text: `Timeout ${cfg.maxMinutes} min — dernière obs: ${lastObservation.slice(0, 800)}`,
        mediaBase64: lastShot,
      };
    }

    let shotB64: string | undefined;
    if (uiLikely || role === "vision" || failures >= 2) {
      try {
        const shot = await captureScreen(`agent-${step}`);
        shotB64 = await shrinkImageBase64(shot.base64);
        lastShot = shot.base64;
      } catch (err) {
        lastObservation = `Screenshot échoué: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (step === 1 || step % 4 === 0) {
      await progress(`Étape ${step}/${cfg.maxSteps} (${role})…`);
    }

    const needVision = (uiLikely && (role === "vision" || step === 1 || failures > 0)) && Boolean(shotB64);
    const model = pickModel(cfg, needVision ? "vision" : role, installed, failures);

    const system = `Tu es l'agent PC Master. Tu contrôles un bureau Linux pour accomplir l'objectif utilisateur (bureau Master / Telegram).
${TOOL_SPEC}

Shell autorisé (binaires): ${cfg.shellAllowlist.join(", ")}
Apps autorisées: ${cfg.appAllowlist.join(", ")}
N'utilise ask_user QUE si une info utilisateur est vraiment indispensable (pas pour demander si une commande allowlistée est OK).
Pour une question conversationnelle (salut, ça va…), réponds directement avec {"tool":"done","summary":"..."}.
Dès que tu as la réponse (ex. sortie shell), appelle immédiatement done — ne répète pas shell.

Skills disponibles:
${skillsContext(cfg)}
${skillHint ? `\nSkill active:\n${skillHint}\n` : ""}
Modèle actuel: ${model} (role=${role}). Tu peux changer avec {"tool":"model",...}.
`;

    const user = `OBJECTIF:
${goal}

Historique actions:
${history.slice(-12).join("\n") || "(début)"}

Dernière observation:
${lastObservation || "(screenshot joint si vision)"}

Étape ${step}/${cfg.maxSteps}. Choisis LA prochaine action JSON.`;

    let raw = "";
    try {
      raw = await ollamaChat(cfg, {
        model,
        system,
        user,
        imageBase64: needVision ? shotB64 : undefined,
        temperature: 0.15,
      });
    } catch (err) {
      failures++;
      lastObservation = `Ollama erreur: ${err instanceof Error ? err.message : String(err)}`;
      audit(cfg, "ollama_error", { err: lastObservation, model });
      // Sur timeout / erreur → forcer le modèle rapide
      role = "fast";
      continue;
    }

    const action = parseAgentAction(raw);
    if (!action) {
      failures++;
      lastObservation = `JSON invalide du modèle: ${raw.slice(0, 400)}`;
      history.push(`#${step} parse_fail`);
      continue;
    }

    audit(cfg, "action", { step, tool: action.tool, model });
    const exec = await executeAction(cfg, action);
    history.push(`#${step} ${action.tool}: ${exec.text.slice(0, 180)}`);
    lastObservation = exec.text;
    if (exec.mediaBase64) lastShot = exec.mediaBase64;
    if (exec.skillHint) skillHint = exec.skillHint;

    if (action.tool === "done") {
      return { status: "completed", text: action.summary.slice(0, 3500), mediaBase64: lastShot };
    }
    if (action.tool === "ask_user") {
      return {
        status: "paused",
        text: action.question.slice(0, 2000),
        mediaBase64: lastShot,
      };
    }
    // Réponse info simple: un shell OK (date/uptime/…) suffit
    if (
      action.tool === "shell" &&
      exec.ok &&
      !uiLikely &&
      exec.text.trim() &&
      (/^(date|uptime|whoami|uname|pwd|df|echo)\b/i.test(action.command.trim()) ||
        /\b(heure|date|uptime|whoami|uname)\b/i.test(goal))
    ) {
      return { status: "completed", text: exec.text.trim().slice(0, 3500) };
    }
    if (action.tool === "model") {
      role = action.role;
      failures = 0;
    }
    if (!exec.ok) failures++;
    else failures = Math.max(0, failures - 1);

    await sleep(400);
  }

  return {
    status: "failed",
    text: `Max steps (${cfg.maxSteps}) atteint.\n${history.slice(-8).join("\n")}`,
    mediaBase64: lastShot,
  };
}

async function executeAction(
  cfg: AgentConfig,
  action: AgentAction,
): Promise<{ ok: boolean; text: string; mediaBase64?: string; skillHint?: string }> {
  try {
    switch (action.tool) {
      case "click": {
        await mouseClick(cfg, action.x, action.y, action.button);
        return { ok: true, text: `click ${action.x},${action.y}` };
      }
      case "type": {
        await typeText(cfg, action.text);
        return { ok: true, text: `typed ${action.text.slice(0, 80)}` };
      }
      case "hotkey": {
        await hotkey(cfg, action.keys);
        return { ok: true, text: `hotkey ${action.keys}` };
      }
      case "scroll": {
        await scroll(cfg, action.amount);
        return { ok: true, text: `scroll ${action.amount}` };
      }
      case "shell": {
        const r = await runSafeShell(cfg, action.command);
        return { ok: r.ok, text: r.text };
      }
      case "open_app": {
        const msg = await openApp(cfg, action.app);
        await sleep(1500);
        return { ok: true, text: msg };
      }
      case "ask_user":
        return { ok: true, text: action.question };
      case "save_skill": {
        const s = saveSkill(cfg, action.name, action.body);
        return { ok: true, text: `skill sauvée: ${s.name}` };
      }
      case "use_skill": {
        const s = loadSkill(cfg, action.name);
        if (!s) return { ok: false, text: `skill inconnue: ${action.name}` };
        return { ok: true, text: `skill chargée: ${s.name}`, skillHint: s.body.slice(0, 4000) };
      }
      case "escalate_chatgpt": {
        const r = await escalateChatGPT(cfg, action.prompt);
        return { ok: r.ok, text: r.text, mediaBase64: r.screenshotBase64 };
      }
      case "wait": {
        await sleep(Math.min(15_000, Math.max(200, action.ms ?? 1000)));
        return { ok: true, text: `wait ${action.ms ?? 1000}ms` };
      }
      case "screenshot": {
        const shot = await captureScreen("agent-manual");
        return { ok: true, text: "screenshot ok", mediaBase64: shot.base64 };
      }
      case "model":
        return { ok: true, text: `switch model role=${action.role}` };
      case "done":
        return { ok: true, text: action.summary };
      default:
        return { ok: false, text: "outil inconnu" };
    }
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Shrink screenshot for Ollama (full PNG ~1.5MB freezes vision models). */
async function shrinkImageBase64(pngBase64: string): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFile, readFile, unlink } = await import("node:fs/promises");
    const execFileAsync = promisify(execFile);
    const inPath = `/tmp/agent-in-${process.pid}.png`;
    const outPath = `/tmp/agent-out-${process.pid}.jpg`;
    await writeFile(inPath, Buffer.from(pngBase64, "base64"));
    await execFileAsync("convert", [inPath, "-resize", "1024x>", "-quality", "70", outPath], {
      timeout: 15_000,
    });
    const out = await readFile(outPath);
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
    return out.toString("base64");
  } catch {
    // fallback: truncate-ish by returning original (better than crash)
    return pngBase64;
  }
}
