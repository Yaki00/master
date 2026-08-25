import { execFile } from "node:child_process";
import { hostname as osHostname, homedir } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { interpretOpenclawOutput } from "./reply.js";
import { hardenReply, ollamaFastChat } from "./fast-chat.js";
import { assessReplyFit, interimAckText } from "./interim.js";
import { parseHistoryPayload } from "./memory.js";
import {
  buildOfficeAgentArgs,
  cancelActiveRun,
  DEFAULT_OFFICE_AGENT,
  DEFAULT_OFFICE_MODEL,
  resolveRunAgent,
  runOpenclawTracked,
  shouldFastChatAgent,
  shouldUseFastChat,
} from "./office-run.js";
import {
  pickBureauSession,
  readableTask,
  statusFromSession,
  toolsFromSession,
  type SessionLike,
} from "./session-status.js";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const path = join(HERE, "..", ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const MASTER_URL = (process.env.MASTER_PUBLIC_URL ?? process.env.MASTER_URL ?? "https://master.pixelbrain.fr").replace(
  /\/$/,
  "",
);
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? "";
const WORKER_ID = process.env.WORKER_ID ?? "openclaw-mac";
const POLL_MS = Number(process.env.OFFICE_POLL_MS ?? "4000");
const CMD_POLL_MS = Number(process.env.OFFICE_CMD_POLL_MS ?? "3000");
const RECURRING_TICK_MS = Math.max(30_000, Number(process.env.OFFICE_RECURRING_TICK_MS) || 60_000);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
const OPENCLAW_TIMEOUT_SEC = Math.max(20, Number(process.env.OPENCLAW_TIMEOUT_SEC) || 60);
/** Progress ticks pendant un run long (CDC-05). */
const OFFICE_PROGRESS_MS = Math.max(10_000, Number(process.env.OFFICE_PROGRESS_MS) || 20_000);
const OFFICE_MODEL = (process.env.OFFICE_MODEL ?? DEFAULT_OFFICE_MODEL).trim() || DEFAULT_OFFICE_MODEL;
const OFFICE_AGENT = (process.env.OFFICE_AGENT ?? DEFAULT_OFFICE_AGENT).trim() || DEFAULT_OFFICE_AGENT;
const OFFICE_LOCAL = process.env.OFFICE_LOCAL !== "0";
const OFFICE_FAST_CHAT = process.env.OFFICE_FAST_CHAT !== "0";
const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");

type IngestAgent = {
  id: string;
  kind: "openclaw";
  name: string;
  status: "working" | "idle" | "waiting" | "error" | "offline";
  task: string | null;
  currentAction: string | null;
  tools?: string[];
  meta: Record<string, unknown>;
};

type OfficeCommand = {
  id: string;
  agentId: string;
  kind: "message" | "pause" | "resume" | "stop";
  payload: Record<string, unknown>;
};

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${WORKER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function runOpenclaw(
  args: string[],
  timeoutSec = 30,
  opts: { agentId?: string; commandId?: string } = {},
): Promise<string> {
  if (opts.agentId) {
    return runOpenclawTracked(OPENCLAW_BIN, opts.agentId, args, timeoutSec, {
      commandId: opts.commandId,
      env: process.env,
    });
  }
  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, args, {
    timeout: timeoutSec * 1000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  return `${stdout}\n${stderr}`;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listConfiguredAgents(): Array<{ id: string; name: string; model?: string; tools?: string[] }> {
  const cfgPath = join(OPENCLAW_HOME, "openclaw.json");
  if (!existsSync(cfgPath)) return [];
  const cfg = readJsonFile(cfgPath) as {
    agents?: { list?: Array<Record<string, unknown>> };
  };
  const list = Array.isArray(cfg.agents?.list) ? cfg.agents!.list! : [];
  return list.map((raw) => {
    const toolsProfile = (raw.tools as { profile?: string; alsoAllow?: string[] } | undefined) ?? {};
    const tools = [
      ...(toolsProfile.profile ? [toolsProfile.profile] : []),
      ...(Array.isArray(toolsProfile.alsoAllow) ? toolsProfile.alsoAllow : []),
    ];
    const model =
      typeof raw.model === "string"
        ? raw.model
        : String((raw.model as { primary?: string } | undefined)?.primary ?? "");
    return {
      id: String(raw.id ?? "main"),
      name: String(raw.name ?? raw.id ?? "main"),
      model: model || undefined,
      tools,
    };
  });
}

function enrichSessionFromJsonl(session: SessionLike, sessionFile: string | null): SessionLike {
  if (!sessionFile || !existsSync(sessionFile)) return session;
  try {
    const lines = readFileSync(sessionFile, "utf8").trim().split("\n").slice(-40);
    let lastUser: string | null = null;
    let lastTool: string | null = null;
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const role = String(row.role ?? row.type ?? "");
        if (role === "user" || role === "human") {
          const content = row.content ?? row.text ?? row.message;
          if (typeof content === "string" && content.trim()) lastUser = content.trim().slice(0, 200);
          else if (Array.isArray(content)) {
            const t = content.find((c) => typeof c === "object" && c && "text" in (c as object));
            if (t && typeof (t as { text?: string }).text === "string") {
              lastUser = String((t as { text: string }).text).slice(0, 200);
            }
          }
        }
        const toolName =
          row.toolName ??
          row.name ??
          (row.tool as { name?: string } | undefined)?.name ??
          (row.type === "tool" || row.type === "toolCall" || role === "tool" || role === "toolResult"
            ? row.name ?? (row as { toolCallName?: string }).toolCallName
            : null);
        if (toolName && typeof toolName === "string") lastTool = toolName;
      } catch {
        /* skip bad line */
      }
    }
    return {
      ...session,
      lastUserMessage: lastUser ?? session.lastUserMessage,
      lastTool: lastTool ?? session.lastTool,
    };
  } catch {
    return session;
  }
}

function latestSessionForAgent(agentId: string): SessionLike | null {
  const storePath = join(OPENCLAW_HOME, "agents", agentId, "sessions", "sessions.json");
  if (!existsSync(storePath)) return null;
  try {
    const store = readJsonFile(storePath) as Record<string, Record<string, unknown>>;
    const entries: Array<{ key: string; updatedAt: number; session: SessionLike }> = [];
    for (const [key, value] of Object.entries(store)) {
      if (!value || typeof value !== "object") continue;
      const updatedAt = Number(value.updatedAt ?? value.lastInteractionAt ?? 0);
      const sessionFile = value.sessionFile != null ? String(value.sessionFile) : null;
      entries.push({
        key,
        updatedAt,
        session: enrichSessionFromJsonl({ ...value, key }, sessionFile),
      });
    }
    return pickBureauSession(entries, agentId);
  } catch (err) {
    console.warn("[office-bridge] sessions read failed", agentId, err);
    return null;
  }
}

function collectAgentsFromDisk(): IngestAgent[] {
  let configured = listConfiguredAgents();
  if (configured.length === 0) {
    const agentsDir = join(OPENCLAW_HOME, "agents");
    if (existsSync(agentsDir)) {
      configured = readdirSync(agentsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ id: d.name, name: d.name }));
    }
  }

  return configured.map((raw) => {
    const session = latestSessionForAgent(raw.id);
    const status = statusFromSession(session);
    const { tools, currentAction } = toolsFromSession(session, raw.tools ?? []);
    const task = readableTask(session, raw.name);
    return {
      id: `openclaw:${raw.id}`,
      kind: "openclaw" as const,
      name: raw.name,
      status,
      task,
      currentAction,
      tools,
      meta: {
        model: OFFICE_MODEL,
        sessionKey: session?.key ?? null,
        sessionStatus: session?.status ?? null,
        source: "disk",
      },
    };
  });
}

let lastIngestFingerprint = "";
let ingestBackoffMs = 0;
let ingestFailUntil = 0;

async function ingest(agents: IngestAgent[]) {
  if (Date.now() < ingestFailUntil) return;
  const fingerprint = agents.map((a) => `${a.id}:${a.status}:${a.task}:${a.currentAction}`).join("|");
  const res = await fetch(`${MASTER_URL}/api/office/ingest`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      source: "openclaw-mac",
      hostname: osHostname(),
      agents,
    }),
  });
  if (!res.ok) {
    const status = res.status;
    console.error("[office-bridge] ingest failed", status);
    ingestBackoffMs = Math.min(60_000, Math.max(5_000, ingestBackoffMs * 2 || 5_000));
    ingestFailUntil = Date.now() + ingestBackoffMs;
    return;
  }
  ingestBackoffMs = 0;
  ingestFailUntil = 0;
  if (fingerprint !== lastIngestFingerprint) {
    lastIngestFingerprint = fingerprint;
    console.log(
      "[office-bridge] ingest",
      agents.length,
      "agents",
      agents.map((a) => `${a.name}:${a.status}`).join(", "),
    );
  }
}

async function pullCommands(): Promise<OfficeCommand[]> {
  const res = await fetch(`${MASTER_URL}/api/office/commands?workerId=${encodeURIComponent(WORKER_ID)}&limit=5`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    if (res.status !== 502) console.error("[office-bridge] commands failed", res.status);
    return [];
  }
  const data = (await res.json()) as { commands?: OfficeCommand[] };
  return data.commands ?? [];
}

async function ackCommand(
  id: string,
  status: "done" | "failed",
  result: string,
  opts?: { summary?: string },
) {
  const res = await fetch(`${MASTER_URL}/api/office/commands/${id}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      status,
      result,
      ...(opts?.summary ? { summary: opts.summary } : {}),
    }),
  });
  if (!res.ok) {
    console.error("[office-bridge] ack failed", id, res.status);
  } else {
    console.log("[office-bridge] ack", status, id.slice(0, 8), result.slice(0, 80));
  }
}

async function postOfficeEvent(
  agentId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(`${MASTER_URL}/api/office/events`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ agentId, kind, payload }),
    });
    if (!res.ok) {
      console.error("[office-bridge] event failed", res.status);
    }
  } catch (err) {
    console.error("[office-bridge] event", err);
  }
}

async function emitInterim(cmd: OfficeCommand, message: string): Promise<void> {
  const text = interimAckText(message);
  const taskId = typeof cmd.payload.taskId === "string" ? cmd.payload.taskId : undefined;
  await postOfficeEvent(cmd.agentId, "agent_message", {
    text,
    role: "agent",
    interim: true,
    commandId: cmd.id,
    ...(taskId ? { taskId } : {}),
  });
  await postOfficeEvent(cmd.agentId, "reflection", {
    text: `Réflexion — demande: ${message.slice(0, 280)}`,
    role: "system",
    reflection: true,
    commandId: cmd.id,
    ...(taskId ? { taskId } : {}),
  });
  if (taskId) {
    await patchTaskStatus(taskId, "thinking", "meeting");
  }
  console.log("[office-bridge] interim", cmd.id.slice(0, 8), text.slice(0, 60));
}

async function patchTaskStatus(
  taskId: string,
  status: string,
  phase?: string,
): Promise<void> {
  try {
    await fetch(`${MASTER_URL}/api/office/tasks`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        id: taskId,
        status,
        ...(phase ? { phase } : {}),
        note: `bridge→${status}`,
      }),
    });
  } catch (err) {
    console.error("[office-bridge] task patch", err);
  }
}

async function emitProgress(cmd: OfficeCommand, elapsedMs: number): Promise<void> {
  const sec = Math.round(elapsedMs / 1000);
  const taskId = typeof cmd.payload.taskId === "string" ? cmd.payload.taskId : undefined;
  await postOfficeEvent(cmd.agentId, "progress", {
    text: `Toujours en cours… (${sec}s)`,
    role: "system",
    progress: true,
    commandId: cmd.id,
    elapsedMs,
    ...(taskId ? { taskId } : {}),
  });
  if (taskId) {
    await patchTaskStatus(taskId, "working", "execution");
  }
}

function extractSpawns(blob: string): Array<{ childSessionKey: string; taskName?: string; runId?: string }> {
  const found: Array<{ childSessionKey: string; taskName?: string; runId?: string }> = [];
  const re =
    /"childSessionKey"\s*:\s*"([^"]+)"[\s\S]{0,200}?"(?:taskName|runId)"\s*:\s*"([^"]+)"|"childSessionKey"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(blob))) {
    const key = m[1] || m[3];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push({
      childSessionKey: key,
      taskName: m[1] && m[2] && !m[2].includes("-") ? m[2] : m[2],
      runId: m[2],
    });
  }
  // simpler fallback
  for (const m2 of blob.matchAll(/"childSessionKey"\s*:\s*"([^"]+)"/g)) {
    const key = m2[1]!;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ childSessionKey: key });
  }
  return found;
}

async function emitSpawnTree(cmd: OfficeCommand, blob: string): Promise<void> {
  for (const s of extractSpawns(blob)) {
    await postOfficeEvent(cmd.agentId, "spawn_tree", {
      text: `Spawn ${s.taskName ?? "employé"}`,
      role: "system",
      spawn: true,
      childSessionKey: s.childSessionKey,
      taskName: s.taskName,
      commandId: cmd.id,
    });
    console.log("[office-bridge] spawn", s.childSessionKey.slice(0, 48));
  }
}

async function emitFitNote(cmd: OfficeCommand, ask: string, reply: string): Promise<void> {
  const fit = assessReplyFit(ask, reply);
  if (fit.ok || !fit.note) return;
  await postOfficeEvent(cmd.agentId, "command_failed", {
    text: fit.note,
    role: "system",
    fit: false,
    commandId: cmd.id,
  });
}

function openclawId(agentId: string): string {
  return agentId.startsWith("openclaw:") ? agentId.slice("openclaw:".length) : agentId;
}

function errorOutput(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`;
  }
  return String(err);
}

function isGatewayError(blob: string): boolean {
  return /control ui did not start|operator.scope|gateway|websocket|ECONNREFUSED|18789/i.test(blob);
}

async function runAgentMessage(agent: string, message: string, commandId?: string): Promise<string> {
  const timeout = OPENCLAW_TIMEOUT_SEC + 20;
  const runAgent = resolveRunAgent(agent, OFFICE_AGENT);
  const args = buildOfficeAgentArgs(runAgent, message, {
    model: OFFICE_MODEL,
    timeoutSec: OPENCLAW_TIMEOUT_SEC,
    local: OFFICE_LOCAL,
  });
  console.log(
    "[office-bridge] model",
    OFFICE_MODEL,
    "agent",
    runAgent,
    OFFICE_LOCAL ? "local" : "gateway",
  );
  try {
    return await runOpenclaw(args, timeout, { agentId: `openclaw:${runAgent}`, commandId });
  } catch (err) {
    const blob = errorOutput(err);
    if (!OFFICE_LOCAL && isGatewayError(blob)) {
      console.warn("[office-bridge] retry --local", runAgent);
      return await runOpenclaw(
        buildOfficeAgentArgs(runAgent, message, {
          model: OFFICE_MODEL,
          timeoutSec: OPENCLAW_TIMEOUT_SEC,
          local: true,
        }),
        timeout,
        { agentId: `openclaw:${runAgent}`, commandId },
      );
    }
    throw err;
  }
}

async function executeCommand(cmd: OfficeCommand) {
  const agent = openclawId(cmd.agentId);
  const text = typeof cmd.payload.text === "string" ? cmd.payload.text.trim() : "";
  const started = Date.now();

  // Pause / stop : tenter SIGTERM sur run suivi + signal OpenClaw best-effort
  if (cmd.kind === "pause" || cmd.kind === "stop") {
    console.log("[office-bridge] control", cmd.kind, agent);
    const cancel = cancelActiveRun(cmd.agentId);
    const controlDetail = cancel.signalled
      ? cancel.detail
      : cancel.hadRun
        ? cancel.detail
        : "OpenClaw ne garantit pas l'abort d'un run déjà claimed côté gateway — meta sync via ingest";

    await postOfficeEvent(cmd.agentId, `command_${cmd.kind}`, {
      text:
        cmd.kind === "stop"
          ? `Stop demandé — ${controlDetail}`
          : `Pause demandée — ${controlDetail}`,
      role: "system",
      commandId: cmd.id,
      controlSignal: cancel.signalled ? "sigterm" : "none",
    });

    const ackText = cancel.signalled
      ? `${cmd.kind === "stop" ? "Stop" : "Pause"} signalé (${cancel.detail}).`
      : cmd.kind === "stop"
        ? "Stop ack — run OpenClaw non abortable si déjà claimed (meta sync via ingest)."
        : "Pause ack — best-effort (run claimed peut continuer côté gateway).";

    await ackCommand(cmd.id, "done", ackText);

    const runAgent = resolveRunAgent(agent, OFFICE_AGENT);
    const stopMsg =
      cmd.kind === "stop"
        ? "STOP immédiat : abandonne la tâche en cours, réponds uniquement STOP-ACK."
        : "PAUSE : interromps le travail, réponds uniquement PAUSE-ACK.";
    void (async () => {
      try {
        await Promise.race([
          runOpenclaw(
            buildOfficeAgentArgs(runAgent, stopMsg, {
              model: OFFICE_MODEL,
              timeoutSec: 12,
              local: true,
            }),
            15,
            { agentId: cmd.agentId },
          ),
          new Promise<string>((r) => setTimeout(() => r(""), 8_000)),
        ]);
      } catch (err) {
        console.warn("[office-bridge] control signal", err instanceof Error ? err.message : err);
      }
    })();
    return;
  }

  const message =
    cmd.kind === "resume" ? text || "Reprendre la tâche en cours." : text;
  if (!message) {
    await ackCommand(cmd.id, "failed", "message vide");
    return;
  }

  console.log("[office-bridge] exec", cmd.kind, agent);
  try {
    const mem = parseHistoryPayload(cmd.payload);
    const personaHint =
      typeof cmd.payload.personaHint === "string" ? cmd.payload.personaHint.trim() : "";
    const taskId = typeof cmd.payload.taskId === "string" ? cmd.payload.taskId : undefined;
    if (
      shouldUseFastChat(message, OFFICE_FAST_CHAT, cmd.payload) &&
      shouldFastChatAgent(agent) &&
      agent !== "telegram-pc"
    ) {
      console.log("[office-bridge] fast-chat ollama", `hist=${mem.history.length}`);
      const { reply, summary } = await ollamaFastChat({
        message: personaHint ? `[Persona] ${personaHint}\n\n${message}` : message,
        history: mem.history,
        summary: mem.summary,
        roster: mem.roster,
      });
      await emitFitNote(cmd, message, reply);
      await ackCommand(cmd.id, "done", reply, {
        summary: summary && summary !== mem.summary ? summary : undefined,
      });
      return;
    }

    // Chemin long : interim immédiat + progress ticks (CDC-05)
    await emitInterim(cmd, message);
    if (taskId) await patchTaskStatus(taskId, "working", "execution");
    const contextual =
      mem.history.length > 0 || mem.summary || personaHint
        ? [
            personaHint ? `Persona agent: ${personaHint}` : "",
            mem.summary ? `Résumé antérieur: ${mem.summary}` : "",
            ...mem.history.slice(-6).map((t) => `${t.role === "user" ? "Humain" : "Agent"}: ${t.content}`),
            "",
            `Message actuel: ${message}`,
          ]
            .filter(Boolean)
            .join("\n")
        : message;

    const progressTimer = setInterval(() => {
      void emitProgress(cmd, Date.now() - started);
      // Garde le Mac « online » pendant les runs longs (ingest découplé + heartbeat forcé)
      void ingestLoop();
    }, OFFICE_PROGRESS_MS);

    let out = "";
    try {
      out = await runAgentMessage(agent, contextual, cmd.id);
    } finally {
      clearInterval(progressTimer);
    }

    await emitSpawnTree(cmd, out);
    const interpreted = interpretOpenclawOutput(out);
    if (!interpreted.ok) {
      await ackCommand(cmd.id, "failed", interpreted.text.slice(0, 800));
      return;
    }
    const reply = hardenReply(interpreted.text).slice(0, 2000);
    const finalText = reply || `${cmd.kind} ok (${Date.now() - started}ms)`;
    await emitFitNote(cmd, message, finalText);
    await ackCommand(cmd.id, "done", finalText);
  } catch (err) {
    const blob = errorOutput(err);
    const aborted =
      /SIGTERM|SIGKILL|signal|killed|abort/i.test(blob) ||
      (err instanceof Error && /SIGTERM|SIGKILL|signal|killed|abort/i.test(err.message));
    if (aborted) {
      await ackCommand(cmd.id, "failed", "Run interrompu (pause/stop).");
      return;
    }
    const interpreted = interpretOpenclawOutput(blob);
    const detail = interpreted.text || (err instanceof Error ? err.message : String(err));
    await ackCommand(cmd.id, "failed", detail.slice(0, 800));
  }
}

let ingestBusy = false;
let cmdBusy = false;

async function ingestLoop() {
  if (ingestBusy) return;
  ingestBusy = true;
  try {
    const agents = collectAgentsFromDisk();
    await ingest(agents);
  } catch (err) {
    console.error("[office-bridge] collect/ingest", err);
  } finally {
    ingestBusy = false;
  }
}

async function recurringTickLoop() {
  try {
    const res = await fetch(`${MASTER_URL}/api/office/cron/recurring`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status !== 502) console.error("[office-bridge] recurring tick failed", res.status);
      return;
    }
    const data = (await res.json()) as { ticked?: number; meetingTimeout?: boolean };
    if (data.ticked || data.meetingTimeout) {
      console.log("[office-bridge] recurring tick", data);
    }
  } catch (err) {
    console.error("[office-bridge] recurring tick", err);
  }
}

async function commandsLoop() {
  if (cmdBusy) return;
  cmdBusy = true;
  try {
    const commands = await pullCommands();
    for (const cmd of commands) {
      await executeCommand(cmd);
    }
  } catch (err) {
    console.error("[office-bridge] commands", err);
  } finally {
    cmdBusy = false;
  }
}

async function main() {
  if (!WORKER_TOKEN) {
    console.error("[office-bridge] WORKER_TOKEN manquant");
    process.exit(1);
  }
  console.log(
    `[office-bridge] → ${MASTER_URL} ingest=${POLL_MS}ms cmds=${CMD_POLL_MS}ms agent=${OFFICE_AGENT} model=${OFFICE_MODEL} fast=${OFFICE_FAST_CHAT ? "on" : "off"} home=${OPENCLAW_HOME}`,
  );
  await ingestLoop();
  void recurringTickLoop();
  setInterval(() => {
    void ingestLoop();
  }, POLL_MS);
  setInterval(() => {
    void commandsLoop();
  }, CMD_POLL_MS);
  setInterval(() => {
    void recurringTickLoop();
  }, RECURRING_TICK_MS);
}

void main();
