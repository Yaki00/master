type Job = {
  id: string;
  target: string;
  status: string;
  prompt: string;
  waChatId: string;
  cursorAgentId: string | null;
  cursorRunId: string | null;
};

const MASTER_URL = (process.env.MASTER_URL ?? "https://master.pixelbrain.fr").replace(/\/$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? "";
const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";
const WORKER_ID = process.env.WORKER_ID ?? "orchestrator-vps";
const POLL_MS = Number(process.env.ORCHESTRATOR_POLL_MS ?? "5000");
const MODEL = process.env.CURSOR_MODEL ?? "composer-2.5";
const CLOUD_REPOS = (process.env.CURSOR_CLOUD_REPOS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PROGRESS_COOLDOWN_MS = Number(process.env.PROGRESS_COOLDOWN_MS ?? process.env.WA_PROGRESS_COOLDOWN_MS ?? "45000");

const lastProgressAt = new Map<string, number>();
let pcWasOnline: boolean | null = null;
let lastPcOfflineNotifyAt = 0;

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${WORKER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function notifyPcOfflineIfNeeded() {
  try {
    const res = await fetch(`${MASTER_URL}/api/jobs?limit=5`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = (await res.json()) as {
      workers: { workerId: string; lastSeenAt: string }[];
    };
    const pc = data.workers.find((w) => w.workerId === "pc-main");
    const online = Boolean(
      pc && Date.now() - new Date(pc.lastSeenAt).getTime() < 90_000,
    );
    if (pcWasOnline === true && !online && Date.now() - lastPcOfflineNotifyAt > 15 * 60_000) {
      lastPcOfflineNotifyAt = Date.now();
      // WhatsApp retiré — log seulement (Telegram/bureau gèrent le chat)
      console.warn("[orchestrator] PC went offline — jobs en attente");
    }
    pcWasOnline = online;
  } catch {
    /* ignore */
  }
}

async function heartbeat() {
  await fetch(`${MASTER_URL}/api/workers/pc/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workerId: WORKER_ID,
      hostname: process.env.HOSTNAME ?? "orchestrator",
      meta: { role: "orchestrator" },
    }),
  });
}

async function claimCloudJob(): Promise<Job | null> {
  const res = await fetch(`${MASTER_URL}/api/workers/pc/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workerId: WORKER_ID,
      role: "orchestrator",
      targets: ["cloud"],
    }),
  });
  if (!res.ok) {
    console.error("[orchestrator] claim failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { job: Job | null };
  return data.job;
}

async function complete(
  jobId: string,
  payload: {
    status: "completed" | "failed";
    resultText?: string;
    error?: string;
    cursorAgentId?: string;
    cursorRunId?: string;
  },
) {
  await fetch(`${MASTER_URL}/api/workers/pc/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ jobId, ...payload }),
  });
}

async function progress(jobId: string, message: string, extra?: { cursorAgentId?: string; cursorRunId?: string }) {
  const last = lastProgressAt.get(jobId) ?? 0;
  if (Date.now() - last < PROGRESS_COOLDOWN_MS) return;
  lastProgressAt.set(jobId, Date.now());
  await fetch(`${MASTER_URL}/api/workers/progress`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ jobId, message, ...extra }),
  });
}

async function runCloudJob(job: Job) {
  if (!CURSOR_API_KEY) {
    await complete(job.id, { status: "failed", error: "CURSOR_API_KEY missing on orchestrator" });
    return;
  }
  if (CLOUD_REPOS.length === 0) {
    await complete(job.id, {
      status: "failed",
      error: "CURSOR_CLOUD_REPOS empty — set owner/repo list for cloud agents",
    });
    return;
  }

  const { Agent, CursorAgentError } = await import("@cursor/sdk");

  try {
    await using agent = job.cursorAgentId
      ? await Agent.resume(job.cursorAgentId, { apiKey: CURSOR_API_KEY })
      : await Agent.create({
          apiKey: CURSOR_API_KEY,
          model: { id: MODEL },
          cloud: {
            repos: CLOUD_REPOS.map((url) =>
              url.includes("github.com") || url.includes("gitlab.com")
                ? { url }
                : { url: `https://github.com/${url}` },
            ),
          },
        });

    const agentId = agent.agentId;
    await progress(job.id, "Cursor Cloud démarré…", { cursorAgentId: agentId });

    const run = await agent.send(job.prompt);
    await progress(job.id, `Run ${run.id} en cours…`, {
      cursorAgentId: agentId,
      cursorRunId: run.id,
    });

    let buffer = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") buffer += block.text;
        }
        if (buffer.length > 400) {
          await progress(job.id, buffer.slice(-800), { cursorAgentId: agentId, cursorRunId: run.id });
          buffer = "";
        }
      }
    }

    const result = await run.wait();
    if (result.status === "error") {
      await complete(job.id, {
        status: "failed",
        error: `run failed: ${result.id}`,
        cursorAgentId: agentId,
        cursorRunId: result.id,
      });
      return;
    }

    const text =
      ("result" in result && typeof result.result === "string" && result.result) ||
      buffer ||
      `Terminé (${result.status})`;

    await complete(job.id, {
      status: "completed",
      resultText: String(text).slice(0, 3500),
      cursorAgentId: agentId,
      cursorRunId: result.id,
    });
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `startup: ${err.message} retryable=${err.isRetryable}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[orchestrator] job error", job.id, msg);
    await complete(job.id, { status: "failed", error: msg });
  }
}

async function loop() {
  if (!WORKER_TOKEN) {
    console.error("[orchestrator] WORKER_TOKEN required");
    process.exit(1);
  }

  console.log("[orchestrator] started", { MASTER_URL, WORKER_ID, MODEL, repos: CLOUD_REPOS.length });

  for (;;) {
    try {
      await heartbeat();
      await notifyPcOfflineIfNeeded();
      const job = await claimCloudJob();
      if (job) {
        console.log("[orchestrator] claimed", job.id, job.prompt.slice(0, 80));
        await runCloudJob(job);
      }
    } catch (err) {
      console.error("[orchestrator] loop error", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
