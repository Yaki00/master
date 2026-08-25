import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureScreen } from "./screen.js";

const execFileAsync = promisify(execFile);

export type PcTaskResult = {
  ok: boolean;
  text: string;
  screenshotBase64?: string;
  screenshotPath?: string;
  autoVision?: boolean;
};

/**
 * Lightweight PC task runner.
 * - URLs in prompt → open + optional Playwright smoke if PLAYWRIGHT_ENABLED=1
 * - shell: prefix → run allowlisted shell
 * - otherwise echo / note for Cursor local
 */
export async function runPcTask(prompt: string): Promise<PcTaskResult> {
  const shellMatch = prompt.match(/^shell:\s*([\s\S]+)$/i);
  if (shellMatch) {
    return runAllowlistedShell(shellMatch[1]!.trim());
  }

  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && process.env.PLAYWRIGHT_ENABLED === "1") {
    return runPlaywrightSmoke(urlMatch[0]!);
  }

  if (urlMatch && process.platform === "darwin") {
    try {
      await execFileAsync("open", [urlMatch[0]!]);
      const shot = await captureScreen("open-url");
      return {
        ok: true,
        text: `Ouvert ${urlMatch[0]} + screenshot`,
        screenshotBase64: shot.base64,
        screenshotPath: shot.path,
      };
    } catch (err) {
      return { ok: false, text: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    ok: true,
    text: `PC a reçu: ${prompt.slice(0, 500)}\n(Utilise shell: <cmd>, une URL, /screen, ou /continue pour Cursor local)`,
  };
}

async function runAllowlistedShell(cmd: string): Promise<PcTaskResult> {
  const allow = (process.env.PC_SHELL_ALLOWLIST ?? "uname,df,uptime,npm,pnpm,node,git,ls,pwd")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bin = cmd.split(/\s+/)[0] ?? "";
  if (!allow.includes(bin)) {
    return { ok: false, text: `Commande non autorisée: ${bin}. Allowlist: ${allow.join(", ")}` };
  }
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", cmd], {
      timeout: 120_000,
      maxBuffer: 2_000_000,
    });
    return { ok: true, text: (stdout || stderr || "ok").slice(0, 3500) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: msg };
  }
}

async function runPlaywrightSmoke(url: string): Promise<PcTaskResult> {
  let chromium: { launch: (opts: { headless: boolean }) => Promise<{
    newPage: () => Promise<{
      goto: (u: string, o: { waitUntil: string; timeout: number }) => Promise<{ status: () => number } | null>;
      screenshot: (o: { path: string; fullPage: boolean }) => Promise<unknown>;
    }>;
    close: () => Promise<void>;
  }> };

  try {
    const pw = (await new Function("return import('playwright')")()) as {
      chromium: typeof chromium;
    };
    chromium = pw.chromium;
  } catch {
    return {
      ok: false,
      text: "Playwright non installé. cd apps/pc-worker && npm i playwright && npx playwright install chromium",
    };
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    const status = resp?.status() ?? 0;
    const shotPath = `/tmp/pc-worker-pw-${Date.now()}.png`;
    await page.screenshot({ path: shotPath, fullPage: true });
    await browser.close();

    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(shotPath);
    const ok = status >= 200 && status < 400;
    return {
      ok,
      text: `Playwright ${url} → HTTP ${status}`,
      screenshotBase64: buf.toString("base64"),
      screenshotPath: shotPath,
      autoVision: !ok,
    };
  } catch (err) {
    let shot;
    try {
      shot = await captureScreen("pw-fail");
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      text: `Playwright failed: ${err instanceof Error ? err.message : String(err)}`,
      screenshotBase64: shot?.base64,
      screenshotPath: shot?.path,
      autoVision: true,
    };
  }
}
