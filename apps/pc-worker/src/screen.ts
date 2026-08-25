import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScreenshotResult = {
  path: string;
  base64: string;
  mimetype: string;
};

function shotsDir(): string {
  return process.env.PC_SHOTS_DIR ?? join(homedir(), ".master-pc-worker", "shots");
}

/** Capture primary display (macOS screencapture, Linux gnome-screenshot/import fallback). */
export async function captureScreen(label = "screen"): Promise<ScreenshotResult> {
  const dir = shotsDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${label}-${Date.now()}.png`);
  const platform = process.platform;

  if (platform === "darwin") {
    await execFileAsync("screencapture", ["-x", "-C", file]);
  } else if (platform === "linux") {
    const tries: Array<[string, string[]]> = [
      ["scrot", ["-o", file]],
      ["import", ["-window", "root", file]],
      ["gnome-screenshot", ["-f", file]],
    ];
    let lastErr: unknown;
    for (const [bin, args] of tries) {
      try {
        await execFileAsync(bin, args, {
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" },
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
  } else {
    throw new Error(`Screenshot not supported on ${platform}`);
  }

  const buf = await readFile(file);
  return { path: file, base64: buf.toString("base64"), mimetype: "image/png" };
}

export async function writeShotMeta(path: string, meta: unknown) {
  await writeFile(`${path}.json`, JSON.stringify(meta, null, 2));
}
