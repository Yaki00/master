import { hostname as osHostname } from "node:os";
import { loadAgentConfig } from "./agent/config.js";
import { runPcAgent } from "./agent/supervisor.js";
import { captureScreen } from "./screen.js";
import { runPcTask } from "./tasks.js";

type Job = {
  id: string;
  target: "pc" | "screen" | "continue" | "agent" | string;
  prompt: string;
  waChatId: string;
  cursorAgentId: string | null;
};

const MASTER_URL = (process.env.MASTER_URL ?? "https://master.pixelbrain.fr").replace(/\/$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? "";
const WORKER_ID = process.env.WORKER_ID ?? "pc-main";
const POLL_MS = Number(process.env.PC_POLL_MS ?? "4000");
const LOCAL_CWD = process.env.CURSOR_LOCAL_CWD ?? process.cwd();

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${WORKER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function heartbeat() {
  await fetch(`${MASTER_URL}/api/workers/pc/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workerId: WORKER_ID,
      hostname: osHostname(),
      meta: { role: "pc", cwd: LOCAL_CWD, runner: "pc-agent" },
      jobHuntSync: true,
    }),
  });
}

async function triggerJobHuntOnBoot() {
  try {
    const res = await fetch(`${MASTER_URL}/api/job-hunt/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ forceSearch: false }),
    });
    const data = (await res.json()) as { ok?: boolean; skipped?: string; search?: { imported?: number } };
    console.log("[pc-worker] job-hunt boot sync", res.status, data.skipped ?? data.search?.imported ?? "ok");
  } catch (err) {
    console.warn("[pc-worker] job-hunt boot sync failed", err);
  }
}

async function claim(): Promise<Job | null> {
  const res = await fetch(`${MASTER_URL}/api/workers/pc/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workerId: WORKER_ID,
      role: "pc",
      targets: ["agent", "pc", "screen", "continue"],
    }),
  });
  if (!res.ok) {
    console.error("[pc-worker] claim failed", res.status);
    return null;
  }
  const data = (await res.json()) as { job: Job | null };
  return data.job;
}

async function complete(
  jobId: string,
  payload: {
    status: "completed" | "failed" | "paused";
    resultText?: string;
    error?: string;
    mediaBase64?: string;
    attachMedia?: boolean;
  },
) {
  await fetch(`${MASTER_URL}/api/workers/pc/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ jobId, ...payload }),
  });
}

async function progress(jobId: string, message: string) {
  // Log only — progress va dans SQLite Master, pas de push messagerie
  console.log("[pc-worker] progress", jobId.slice(0, 8), message);
  await fetch(`${MASTER_URL}/api/workers/progress`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ jobId, message, notify: false }),
  });
}

async function runScreen(job: Job) {
  try {
    const shot = await captureScreen("wa-screen");
    await complete(job.id, {
      status: "completed",
      resultText: job.prompt || "Screenshot PC",
      mediaBase64: shot.base64,
      attachMedia: true,
    });
  } catch (err) {
    await complete(job.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runPc(job: Job) {
  const result = await runPcTask(job.prompt);
  await complete(job.id, {
    status: result.ok ? "completed" : "failed",
    resultText: result.text,
    error: result.ok ? undefined : result.text,
    mediaBase64: result.screenshotBase64,
  });
}

async function runAgent(job: Job) {
  const cfg = loadAgentConfig();
  const result = await runPcAgent({
    cfg,
    goal: job.prompt,
    progress: (message) => progress(job.id, message),
  });
  await complete(job.id, {
    status: result.status,
    resultText: result.text,
    error: result.status === "failed" ? result.text : undefined,
    // Don't attach screenshots for agent text replies (breaks WA send)
    mediaBase64: undefined,
  });
}

async function handle(job: Job) {
  console.log("[pc-worker] claimed", job.target, job.id);
  if (job.target === "screen") return runScreen(job);
  if (job.target === "agent" || job.target === "continue") return runAgent(job);
  return runPc(job);
}

async function loop() {
  if (!WORKER_TOKEN) {
    console.error("[pc-worker] WORKER_TOKEN required");
    process.exit(1);
  }
  const cfg = loadAgentConfig();
  console.log("[pc-worker] started", {
    MASTER_URL,
    WORKER_ID,
    LOCAL_CWD,
    runner: "pc-agent",
    models: cfg.models,
  });

  await triggerJobHuntOnBoot();

  for (;;) {
    try {
      await heartbeat();
      const job = await claim();
      if (job) await handle(job);
    } catch (err) {
      console.error("[pc-worker] loop error", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
