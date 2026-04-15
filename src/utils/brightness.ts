import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Get and set display brightness on macOS using the private DisplayServices framework.
 *
 * The public `brightness` CLI tool (brew install brightness) is broken on
 * Apple Silicon + macOS Sequoia. We use a compiled Swift helper that calls
 * DisplayServicesGetBrightness / DisplayServicesSetBrightness directly.
 *
 * Brightness values are 0.0 to 1.0.
 */

function getHelperPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), "..", "helpers", "brightness_helper");
}

/**
 * Check that the brightness helper binary exists.
 */
export async function checkBrightnessDependencies(): Promise<void> {
  const helper = getHelperPath();
  if (!(await Bun.file(helper).exists())) {
    throw new Error(
      `Brightness helper not found at ${helper}.\n` +
      "  Run: npm run build:helpers",
    );
  }
}

export async function getBrightness(): Promise<number> {
  const helper = getHelperPath();
  try {
    const proc = Bun.spawn([helper, "get"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    const value = parseFloat(text.trim());
    if (!isNaN(value)) return value;
  } catch { /* fall through */ }

  // Fallback: assume middle brightness
  return 0.5;
}

export async function setBrightness(level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(1, level));
  const helper = getHelperPath();

  const proc = Bun.spawn([helper, "set", String(clamped)], {
    stdout: "ignore",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(
      err.trim() || `brightness helper exited with code ${proc.exitCode}`,
    );
  }
}
