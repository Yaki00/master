/** Args CLI + routage bureau : réception légère, chat rapide, délégation. */

import { spawn, type ChildProcess } from "node:child_process";

export const DEFAULT_OFFICE_MODEL = "ollama-mac/qwen2.5-32b-64k:latest";
export const DEFAULT_FAST_MODEL = "qwen2.5-7b-64k:latest";
export const DEFAULT_OFFICE_AGENT = "office";

/** Messages qui forcent OpenClaw (spawn / tools), pas le chat Ollama direct. */
const HEAVY_HINT =
  /\b(code|coding|installe|install|cherche|search|mission|spawn|subagent|d[eé]l[eè]gue|browser|fichier|file|scan|github|ebay|pc\b|terminal|shell|npm|git|debug|refactor|implemente|écris|ecris|crée|cree|lance|ouvre|screenshot)\b/i;

const MEETING_PHRASE_RE =
  /organis(?:e|er|ez)\s+(?:une\s+)?r[eé]union|r[eé]union\s+avec\s+tout\s+le\s+monde|meeting\s+avec\s+tout\s+le\s+monde|avec\s+tout\s+le\s+monde/i;

const MEETING_KEYWORD_RE =
  /\b(r[eé]union|meeting|all[-\s]?hands|tous?\s+le\s+monde|avec\s+tout|ensemble|convie|convoque)\b/i;

const MEETING_TYPO_RE = /\bme[ae]{1,2}t{1,2}ings?\b|\br[eé]uni+ons?\b/i;

const MEETING_ACTION_RE =
  /(?:organis(?:e|er|ez)|fait(?:es)?|lance(?:z)?|convie(?:z)?|convoque(?:z)?)\s+(?:un(?:e)?\s+)?(?:meeting|r[eé]union|all[-\s]?hands|me[ae]{1,2}t{1,2}ing)/i;

const MEETING_GROUP_RE =
  /\b(tout(?:e)?s?\s+le\s+monde|avec\s+tout|l['']?équipe|les\s+gens\s+conc(?:ern|ern)[eé]s?|ensemble)\b/i;

/** Miroir de master-web meeting-intent — bloque fast-chat sur demandes de réunion. */
export function parseMeetingIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (MEETING_PHRASE_RE.test(t) || MEETING_KEYWORD_RE.test(t)) return true;
  if (MEETING_ACTION_RE.test(t)) return true;
  if (MEETING_TYPO_RE.test(t) && (MEETING_GROUP_RE.test(t) || /\bebay\b/i.test(t))) return true;
  if (/\bfait\b.*\bme[ae]{1,2}t{1,2}ing\b/i.test(t)) return true;
  return false;
}

export function officeSessionKey(agentId: string): string {
  const id = agentId.replace(/^openclaw:/, "").trim() || "office";
  return `agent:${id}:bureau`;
}

/** main / réception → agent OpenClaw `office` ; rôles nommés inchangés. */
export function resolveRunAgent(agentId: string, officeAgent = DEFAULT_OFFICE_AGENT): string {
  const id = agentId.replace(/^openclaw:/, "").trim() || "main";
  if (id === "telegram-pc" || id === "chef" || id === "mgr-dev" || id === "mgr-lab") return id;
  if (id === "office" || id === officeAgent) return officeAgent;
  if (id === "main") return officeAgent;
  return officeAgent;
}

export function shouldUseFastChat(message: string, enabled = true, payload?: Record<string, unknown>): boolean {
  if (!enabled) return false;
  if (payload?.forceOpenClaw === true) return false;
  if (payload?.meetingRound === true || payload?.meetingSynthesis === true) return false;
  if (payload?.meetingStatus === true) return false;
  if (payload?.handoff === true) return false;
  if (payload?.projectSpeech === true) return false;
  if (payload?.sentinelTick === true) return false;
  if (payload?.mailBrief === true) return false;
  if (typeof payload?.taskId === "string" && payload.taskId) return false;
  const text = message.trim();
  if (!text || text.length > 240) return false;
  if (HEAVY_HINT.test(text)) return false;
  if (parseMeetingIntent(text)) return false;
  if (/\b(ebay|d[eé]l[eè]gue)\b/i.test(text)) return false;
  if (/\b(alors|nouvelles|o[uù]\s+en\s+(?:est|es))\b/i.test(text)) return false;
  if (/\b(sentinelle|surveill(?:e|er|ance)|veill(?:e|er|ance))\b/i.test(text)) return false;
  if (/\b(mail|inbox|bo[iî]te(?:\s+mail)?|courriel)\b/i.test(text)) return false;
  if (/\b(statut|status|avancement)\b/i.test(text)) return false;
  return true;
}

/** Fast chat Ollama = secrétaire only ; chef/managers gardent OpenClaw + âme. */
export function shouldFastChatAgent(agentId: string): boolean {
  const id = agentId.replace(/^openclaw:/, "").trim();
  return id === "office" || id === "main" || id === "";
}

export function buildOfficeAgentArgs(
  agent: string,
  message: string,
  options: { model?: string; timeoutSec?: number; local?: boolean } = {},
): string[] {
  const runAgent = resolveRunAgent(agent);
  const model = (options.model ?? DEFAULT_OFFICE_MODEL).trim() || DEFAULT_OFFICE_MODEL;
  const timeoutSec = Math.max(20, options.timeoutSec ?? 60);
  const local = options.local ?? true;
  const args = [
    "agent",
    "--agent",
    runAgent,
    "--session-key",
    officeSessionKey(runAgent),
    "--model",
    model,
    "--thinking",
    "off",
    "--message",
    message,
    "--timeout",
    String(timeoutSec),
    "--json",
  ];
  if (local) args.push("--local");
  return args;
}

export type CancelRunResult = {
  hadRun: boolean;
  signalled: boolean;
  detail: string;
};

const activeRuns = new Map<string, { child: ChildProcess; commandId?: string }>();

function runKey(agentId: string): string {
  return agentId.replace(/^openclaw:/, "").trim() || agentId;
}

export function hasActiveRun(agentId: string): boolean {
  return activeRuns.has(runKey(agentId));
}

export function clearActiveRun(agentId: string, child?: ChildProcess): void {
  const key = runKey(agentId);
  const cur = activeRuns.get(key);
  if (!cur) return;
  if (child && cur.child !== child) return;
  activeRuns.delete(key);
}

/** Tente SIGTERM (puis SIGKILL) sur un run OpenClaw suivi par le bridge. */
export function cancelActiveRun(agentId: string): CancelRunResult {
  const key = runKey(agentId);
  const cur = activeRuns.get(key);
  if (!cur) {
    return {
      hadRun: false,
      signalled: false,
      detail: "aucun processus OpenClaw suivi pour cet agent",
    };
  }
  activeRuns.delete(key);
  if (cur.child.killed || cur.child.exitCode != null) {
    return { hadRun: true, signalled: false, detail: "processus déjà terminé" };
  }
  try {
    const pid = cur.child.pid;
    const signalled = cur.child.kill("SIGTERM");
    if (signalled && pid) {
      setTimeout(() => {
        if (cur.child.exitCode == null && !cur.child.killed) {
          try {
            cur.child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }, 3000);
      return { hadRun: true, signalled: true, detail: `SIGTERM envoyé (pid ${pid})` };
    }
    return { hadRun: true, signalled: false, detail: "impossible d'envoyer SIGTERM" };
  } catch (err) {
    return {
      hadRun: true,
      signalled: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Lance openclaw avec suivi PID pour pause/stop. */
export function runOpenclawTracked(
  bin: string,
  agentId: string,
  args: string[],
  timeoutSec: number,
  opts: { commandId?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  return new Promise((resolve, reject) => {
    const key = runKey(agentId);
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    activeRuns.set(key, { child, commandId: opts.commandId });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      clearActiveRun(agentId, child);
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const err = new Error(`timeout after ${timeoutSec}s`) as Error & {
        stdout?: string;
        stderr?: string;
      };
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    }, timeoutSec * 1000);

    child.on("error", (err) => {
      clearTimeout(timer);
      clearActiveRun(agentId, child);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearActiveRun(agentId, child);
      const out = `${stdout}\n${stderr}`;
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        const err = new Error(`killed by ${signal}`) as Error & { stdout?: string; stderr?: string };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      if (code != null && code !== 0) {
        const err = new Error(`exit ${code}`) as Error & { stdout?: string; stderr?: string };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(out);
      }
    });
  });
}
