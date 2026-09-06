import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentConfig } from "./config.js";

const execFileAsync = promisify(execFile);

function envDisplay(cfg: AgentConfig): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY: cfg.display };
}

export function jobHuntProfileDir(): string {
  return process.env.PC_JOBHUNT_PROFILE || join(homedir(), ".master-pc-agent", "browser-profile");
}

/** Chrome/Chromium avec profil cookies persistant (LinkedIn, etc.). */
export async function openJobHuntBrowser(cfg: AgentConfig, url: string): Promise<string> {
  const profile = jobHuntProfileDir();
  mkdirSync(profile, { recursive: true });
  const profileQ = JSON.stringify(profile);
  const urlQ = JSON.stringify(url);

  const script = `
set -e
PROFILE=${profileQ}
URL=${urlQ}
mkdir -p "$PROFILE"
if command -v google-chrome >/dev/null 2>&1; then
  nohup google-chrome --user-data-dir="$PROFILE" --new-window "$URL" >/dev/null 2>&1 &
elif command -v google-chrome-stable >/dev/null 2>&1; then
  nohup google-chrome-stable --user-data-dir="$PROFILE" --new-window "$URL" >/dev/null 2>&1 &
elif command -v chromium-browser >/dev/null 2>&1; then
  nohup chromium-browser --user-data-dir="$PROFILE" --new-window "$URL" >/dev/null 2>&1 &
elif command -v chromium >/dev/null 2>&1; then
  nohup chromium --user-data-dir="$PROFILE" --new-window "$URL" >/dev/null 2>&1 &
elif command -v firefox >/dev/null 2>&1; then
  FF_PROFILE="$PROFILE-firefox"
  mkdir -p "$FF_PROFILE"
  nohup firefox --profile "$FF_PROFILE" --new-window "$URL" >/dev/null 2>&1 &
else
  echo "Aucun navigateur (chrome/chromium/firefox)" >&2
  exit 1
fi
echo ok
`;

  await execFileAsync("bash", ["-lc", script], {
    env: envDisplay(cfg),
    timeout: 20_000,
  });
  return `Navigateur Job Hunt ouvert → ${url} (profil ${profile})`;
}

async function tryBins(
  cfg: AgentConfig,
  candidates: Array<[string, string[]]>,
): Promise<{ bin: string; stdout: string; stderr: string }> {
  let lastErr: unknown;
  for (const [bin, args] of candidates) {
    try {
      const r = await execFileAsync(bin, args, { env: envDisplay(cfg), timeout: 15_000 });
      return { bin, stdout: r.stdout, stderr: r.stderr };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function mouseMove(cfg: AgentConfig, x: number, y: number): Promise<void> {
  const xi = Math.round(x);
  const yi = Math.round(y);
  await tryBins(cfg, [
    ["xdotool", ["mousemove", "--sync", String(xi), String(yi)]],
    ["ydotool", ["mousemove", "--absolute", "-x", String(xi), "-y", String(yi)]],
  ]);
}

export async function mouseClick(
  cfg: AgentConfig,
  x: number,
  y: number,
  button: "left" | "right" | "middle" = "left",
): Promise<void> {
  await mouseMove(cfg, x, y);
  const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
  await tryBins(cfg, [
    ["xdotool", ["click", btn]],
    ["ydotool", ["click", btn === "3" ? "1" : btn === "2" ? "2" : "0"]],
  ]);
}

export async function typeText(cfg: AgentConfig, text: string): Promise<void> {
  try {
    const { writeFile } = await import("node:fs/promises");
    const tmp = `/tmp/master-pc-type-${process.pid}.txt`;
    await writeFile(tmp, text, "utf8");
    await execFileAsync("bash", ["-lc", `xclip -selection clipboard < ${JSON.stringify(tmp)}`], {
      env: envDisplay(cfg),
      timeout: 10_000,
    });
    await tryBins(cfg, [
      ["xdotool", ["key", "--clearmodifiers", "ctrl+v"]],
      ["ydotool", ["key", "29:1", "47:1", "47:0", "29:0"]],
    ]);
    return;
  } catch {
    /* fallback type */
  }
  await tryBins(cfg, [
    ["xdotool", ["type", "--clearmodifiers", "--delay", "12", text]],
    ["ydotool", ["type", text]],
  ]);
}

export async function hotkey(cfg: AgentConfig, keys: string): Promise<void> {
  // keys like "ctrl+l" or "alt+Tab"
  const normalized = keys.replace(/\s+/g, "");
  await tryBins(cfg, [
    ["xdotool", ["key", "--clearmodifiers", normalized]],
    ["ydotool", ["key", normalized]],
  ]);
}

export async function scroll(cfg: AgentConfig, amount: number): Promise<void> {
  const clicks = Math.min(20, Math.abs(Math.round(amount)) || 3);
  const btn = amount >= 0 ? "4" : "5"; // xdotool: 4 up, 5 down
  for (let i = 0; i < clicks; i++) {
    await tryBins(cfg, [
      ["xdotool", ["click", btn]],
      ["ydotool", ["click", amount >= 0 ? "4" : "5"]],
    ]);
  }
}

export async function openApp(cfg: AgentConfig, app: string): Promise<string> {
  const name = app.trim().toLowerCase();
  const allowed = cfg.appAllowlist.some((a) => name === a.toLowerCase() || name.includes(a.toLowerCase()));
  if (!allowed) {
    throw new Error(`App non autorisée: ${app}. Allowlist: ${cfg.appAllowlist.join(", ")}`);
  }

  // Map friendly names
  const map: Record<string, string> = {
    cursor: "cursor",
    terminal: "gnome-terminal",
    "gnome-terminal": "gnome-terminal",
    firefox: "firefox",
    chrome: "google-chrome",
    chromium: "chromium-browser",
    browser: "jobhunt",
    jobhunt: "jobhunt",
    "job-hunt": "jobhunt",
    files: "nautilus",
    chatgpt: "firefox",
  };
  const bin = map[name] || name.split(/\s+/)[0]!;

  if (name === "chatgpt") {
    await execFileAsync("bash", ["-lc", `nohup firefox --new-window ${JSON.stringify(cfg.chatgptUrl)} >/dev/null 2>&1 &`], {
      env: envDisplay(cfg),
    });
    return `Ouvert ChatGPT (${cfg.chatgptUrl})`;
  }

  if (bin === "jobhunt" || name === "chrome" || name === "chromium" || name === "browser") {
    const urlMatch = app.match(/https?:\/\/\S+/i);
    return openJobHuntBrowser(cfg, urlMatch?.[0] ?? "https://www.linkedin.com/feed/");
  }

  await execFileAsync("bash", ["-lc", `nohup ${bin} >/dev/null 2>&1 &`], {
    env: envDisplay(cfg),
  });
  return `Ouvert ${bin}`;
}

const DANGEROUS =
  /\b(sudo|rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|passwd|chmod\s+777\s+\/)\b/i;

export async function runSafeShell(cfg: AgentConfig, cmd: string): Promise<{ ok: boolean; text: string }> {
  const trimmed = cmd.trim();
  if (!trimmed) return { ok: false, text: "commande vide" };
  if (DANGEROUS.test(trimmed)) {
    return { ok: false, text: "Commande dangereuse bloquée" };
  }
  const bin = trimmed.split(/\s+/)[0] ?? "";
  if (!cfg.shellAllowlist.includes(bin)) {
    return {
      ok: false,
      text: `Binaire non allowlisté: ${bin}. Autorisés: ${cfg.shellAllowlist.join(", ")}`,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", trimmed], {
      env: envDisplay(cfg),
      timeout: 60_000,
      maxBuffer: 2_000_000,
    });
    return { ok: true, text: (stdout || stderr || "(ok)").slice(0, 4000) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: msg.slice(0, 2000) };
  }
}
