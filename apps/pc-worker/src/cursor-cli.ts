import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type CursorCliResult = {
  ok: boolean;
  text: string;
  chatId?: string;
};

const AGENT_BIN = process.env.CURSOR_AGENT_BIN || "agent";
const WORKSPACE = process.env.CURSOR_LOCAL_CWD || process.cwd();
const MODEL = (process.env.CURSOR_MODEL || "").trim();
/** Prefer Desktop/CLI login (Hobby Auto) over API key billing. */
const USE_LOGIN = process.env.CURSOR_CLI_USE_LOGIN !== "0";
const TIMEOUT_MS = Number(process.env.CURSOR_CLI_TIMEOUT_MS ?? String(15 * 60 * 1000));

function resolveAgentBin(): string {
  if (AGENT_BIN.includes("/") && existsSync(AGENT_BIN)) return AGENT_BIN;
  const home = process.env.HOME || "";
  const local = `${home}/.local/bin/agent`;
  if (existsSync(local)) return local;
  return AGENT_BIN;
}

/**
 * Run Cursor Agent CLI headless (same account as Desktop login when USE_LOGIN).
 */
export async function runCursorCli(opts: {
  prompt: string;
  continueSession?: boolean;
  resumeChatId?: string | null;
}): Promise<CursorCliResult> {
  const bin = resolveAgentBin();
  const args = [
    "-p",
    "--force",
    "--trust",
    "--sandbox",
    "disabled",
    "--output-format",
    "text",
    "--workspace",
    WORKSPACE,
  ];

  if (opts.resumeChatId) {
    args.push("--resume", opts.resumeChatId);
  } else if (opts.continueSession) {
    args.push("--continue");
  }

  // Omit model → CLI default (Auto / account default). Set CURSOR_MODEL to pin.
  if (MODEL && MODEL.toLowerCase() !== "auto") {
    args.push("--model", MODEL);
  }

  args.push(opts.prompt);

  const env = { ...process.env };
  // Avoid forcing paid API path when session login is available
  if (USE_LOGIN) {
    delete env.CURSOR_API_KEY;
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: WORKSPACE,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        text: `Cursor CLI introuvable (${bin}): ${err.message}. Installe: curl https://cursor.com/install -fsS | bash`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const text = (stdout.trim() || stderr.trim() || `(exit ${code})`).slice(0, 8000);
      const chatMatch = `${stdout}\n${stderr}`.match(/chat[_ ]?id["\s:=]+([a-zA-Z0-9_-]+)/i);
      resolve({
        ok: code === 0,
        text,
        chatId: chatMatch?.[1],
      });
    });
  });
}
