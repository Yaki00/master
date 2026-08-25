import type { N8nSummary } from "../types";

const N8N_BASE = process.env.N8N_BASE_URL ?? "https://n8n.pixelbrain.fr";

type N8nWorkflow = {
  id: string;
  name: string;
  active: boolean;
  tags?: { name: string }[];
};

type N8nExecution = {
  id: string;
  status: string;
  startedAt?: string;
  workflowId: string;
};

function extractAiHost(tags?: { name: string }[]): string | null {
  if (!tags) return null;
  const aiTag = tags.find((t) => t.name.startsWith("ai:"));
  return aiTag ? aiTag.name.replace(/^ai:/, "") : null;
}

export async function fetchN8nSummary(): Promise<N8nSummary | null> {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return null;

  const headers = {
    "X-N8N-API-KEY": apiKey,
    Accept: "application/json",
  };

  try {
    const [workflowsRes, runningRes, failedRes] = await Promise.all([
      fetch(`${N8N_BASE}/api/v1/workflows?active=true&limit=50`, { headers, cache: "no-store" }),
      fetch(`${N8N_BASE}/api/v1/executions?status=running&limit=50`, { headers, cache: "no-store" }),
      fetch(`${N8N_BASE}/api/v1/executions?status=error&limit=50`, { headers, cache: "no-store" }),
    ]);

    if (!workflowsRes.ok) {
      console.error("[n8n] workflows", workflowsRes.status);
      return null;
    }

    const workflowsData = (await workflowsRes.json()) as { data?: N8nWorkflow[] };
    const runningData = runningRes.ok ? ((await runningRes.json()) as { data?: N8nExecution[] }) : { data: [] };
    const failedData = failedRes.ok ? ((await failedRes.json()) as { data?: N8nExecution[] }) : { data: [] };

    const workflows = (workflowsData.data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      aiHost: extractAiHost(w.tags),
    }));

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const failed24h = (failedData.data ?? []).filter(
      (e) => e.startedAt && new Date(e.startedAt).getTime() >= dayAgo,
    ).length;

    return {
      activeWorkflows: workflows.length,
      runningExecutions: runningData.data?.length ?? 0,
      failed24h,
      workflows,
    };
  } catch (err) {
    console.error("[n8n] fetch error", err);
    return null;
  }
}
