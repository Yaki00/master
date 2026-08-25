import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ContainerMetrics, HealthStatus, VpsHostMetrics } from "../types";

const execFileAsync = promisify(execFile);
const PROC_BASES = ["/host/proc", "/proc"];

async function readProcFile(name: string): Promise<string | null> {
  for (const base of PROC_BASES) {
    try {
      return await readFile(`${base}/${name}`, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

type CpuTimes = { idle: number; total: number };

function parseCpuLine(stat: string): CpuTimes | null {
  const line = stat.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const parts = line.split(/\s+/).slice(1).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  const idle = parts[3] + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

export async function readCpuPercent(): Promise<number | null> {
  const first = await readProcFile("stat");
  if (!first) return null;
  const t1 = parseCpuLine(first);
  if (!t1) return null;

  await new Promise((r) => setTimeout(r, 1000));

  const second = await readProcFile("stat");
  if (!second) return null;
  const t2 = parseCpuLine(second);
  if (!t2) return null;

  const idleDelta = t2.idle - t1.idle;
  const totalDelta = t2.total - t1.total;
  if (totalDelta <= 0) return null;

  return Math.round((1 - idleDelta / totalDelta) * 100);
}

export async function readHostMemory() {
  for (const path of ["/host/proc/meminfo", "/proc/meminfo"]) {
    try {
      const raw = await readFile(path, "utf8");
      const lines = Object.fromEntries(
        raw
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [k, v] = l.split(":");
            return [k.trim(), Number.parseInt(v.trim(), 10)];
          }),
      );
      const total = lines.MemTotal;
      const available = lines.MemAvailable ?? lines.MemFree;
      if (!total || available === undefined) continue;
      const used = total - available;
      return {
        totalMb: Math.round(total / 1024),
        usedMb: Math.round(used / 1024),
        percent: Math.round((used / total) * 100),
      };
    } catch {
      /* next */
    }
  }
  return { usedMb: null, totalMb: null, percent: null };
}

export async function readLoadAverage(): Promise<number[] | null> {
  try {
    const raw = await readProcFile("loadavg");
    if (!raw) return null;
    return raw
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((n) => Number.parseFloat(n));
  } catch {
    return null;
  }
}

export async function readUptime(): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  const raw = await readProcFile("uptime");
  if (!raw) return { seconds: null, formatted: null };

  const seconds = Number.parseFloat(raw.split(/\s+/)[0]);
  if (Number.isNaN(seconds)) return { seconds: null, formatted: null };

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  let formatted = "";
  if (days > 0) formatted += `${days}j `;
  formatted += `${hours}h ${mins}m`;

  return { seconds, formatted };
}

export async function readDiskUsage(): Promise<{
  percent: number | null;
  usedGb: number | null;
  totalGb: number | null;
}> {
  const targets = ["/host/root", "/"];
  for (const target of targets) {
    try {
      const { stdout } = await execFileAsync("df", ["-P", target], { timeout: 5000 });
      const lines = stdout.trim().split("\n");
      if (lines.length < 2) continue;

      const parts = lines[1].split(/\s+/);
      const totalKb = Number.parseInt(parts[1], 10);
      const usedKb = Number.parseInt(parts[2], 10);
      const capacity = parts[4]?.replace("%", "") ?? "";
      const percent = Number.parseInt(capacity, 10);

      if (Number.isNaN(percent)) continue;

      return {
        percent,
        usedGb: Math.round((usedKb / 1024 / 1024) * 10) / 10,
        totalGb: Math.round((totalKb / 1024 / 1024) * 10) / 10,
      };
    } catch {
      /* try next target */
    }
  }
  return { percent: null, usedGb: null, totalGb: null };
}

async function collectDocker() {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--format", "{{json .}}"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    const containers = lines.map((line) => {
      const row = JSON.parse(line) as { Names: string; State: string; Status: string };
      const name = row.Names.replace(/^\//, "");
      const s = row.Status.toLowerCase();
      let health: HealthStatus = "up";
      if (s.includes("unhealthy") || s.includes("restarting")) health = "down";
      else if (s.includes("starting")) health = "degraded";
      return { name, state: row.State, status: row.Status, health };
    });
    return {
      containersRunning: containers.length,
      containersUnhealthy: containers.filter((c) => c.health !== "up").length,
      containers: containers.sort((a, b) => a.name.localeCompare(b.name)) as ContainerMetrics[],
    };
  } catch {
    return { containersRunning: 0, containersUnhealthy: 0, containers: [] as ContainerMetrics[] };
  }
}

export async function collectVpsMetrics(): Promise<VpsHostMetrics> {
  const [mem, load, docker, cpu, disk, uptime] = await Promise.all([
    readHostMemory(),
    readLoadAverage(),
    collectDocker(),
    readCpuPercent(),
    readDiskUsage(),
    readUptime(),
  ]);

  return {
    id: "vps-main",
    name: "VPS principal",
    ip: "51.210.11.46",
    memoryUsedMb: mem.usedMb,
    memoryTotalMb: mem.totalMb,
    memoryPercent: mem.percent,
    cpuPercent: cpu,
    diskPercent: disk.percent,
    diskUsedGb: disk.usedGb,
    diskTotalGb: disk.totalGb,
    uptimeSeconds: uptime.seconds,
    uptimeFormatted: uptime.formatted,
    loadAverage: load,
    ...docker,
    collectedAt: new Date().toISOString(),
  };
}
