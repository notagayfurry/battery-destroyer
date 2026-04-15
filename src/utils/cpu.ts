import { $ } from "bun";
import { cpus } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * CPU + GPU stress using stress-ng and a Metal compute shader.
 *
 * stress-ng runs heavy workloads on all CPU cores:
 *   - cpu: heavy FP + integer math (all methods cycled)
 *   - matrix: matrix operations (cache + ALU stress)
 *   - cache: L1/L2/L3 cache thrashing
 *   - vm: memory allocation/thrashing
 *
 * gpu_stress is a compiled Swift binary that runs a Metal compute shader
 * in a tight loop to maximize GPU power draw.
 */

let stressProc: ReturnType<typeof Bun.spawn> | null = null;
let gpuProc: ReturnType<typeof Bun.spawn> | null = null;

/**
 * Path to the smc binary (same one used by charging.ts).
 */
const SMC_PATHS = [
  "/usr/local/co.palokaj.battery/smc",
  "/usr/local/bin/smc",
];

let resolvedSmc: string | null = null;

async function findSmc(): Promise<string | null> {
  if (resolvedSmc) return resolvedSmc;
  for (const p of SMC_PATHS) {
    if (await Bun.file(p).exists()) {
      resolvedSmc = p;
      return p;
    }
  }
  return null;
}

export function getCoreCount(): number {
  return cpus().length;
}

/**
 * Get CPU usage percentage (from load average).
 */
export async function getCpuUsage(): Promise<number> {
  const cores = getCoreCount();
  const loadAvg = (await import("os")).loadavg()[0]!;
  return Math.min(100, Math.round((loadAvg / cores) * 100));
}

/**
 * Read a temperature from an SMC key output.
 * The smc tool outputs different formats depending on the key type:
 *
 *   flt type (Apple Silicon):  Tp09  [flt ]  47 (bytes 99 b5 3b 42)
 *   sp78 type (older):         TC0P  [sp78]  (bytes 18 80)
 *
 * For flt type, the decoded value is shown directly before "(bytes ...)".
 * For sp78, we parse the 8.8 fixed-point from the raw bytes.
 */
function parseSmcTemp(output: string): number {
  // Try flt format first: key [flt ] VALUE (bytes ...)
  const fltMatch = output.match(/\[flt\s*\]\s+([\d.]+)/);
  if (fltMatch) {
    const temp = parseFloat(fltMatch[1]!);
    if (temp > 0 && temp < 150) return Math.round(temp * 10) / 10;
  }

  // Try sp78 format: (bytes HH LL)
  const sp78Match = output.match(/\(bytes\s+([0-9a-f]{2})\s+([0-9a-f]{2})\)/i);
  if (sp78Match) {
    const hi = parseInt(sp78Match[1]!, 16);
    const lo = parseInt(sp78Match[2]!, 16);
    const temp = hi + lo / 256;
    if (temp > 0 && temp < 150) return Math.round(temp * 10) / 10;
  }

  return -1;
}

/**
 * Apple Silicon CPU temperature SMC keys (tried in order):
 *   Tp09 - CPU efficiency core (E-cluster)
 *   Tp01 - CPU performance core (P-cluster)
 *   Tp05 - CPU performance core 2
 *   TC0P - CPU proximity (Intel-era, sometimes still works)
 */
const TEMP_KEYS = ["Tp09", "Tp01", "Tp05", "TC0P"];

/**
 * Get CPU temperature by reading SMC keys directly.
 * Returns the highest temperature found across CPU clusters.
 * Falls back to powermetrics, then battery temperature from ioreg.
 */
export async function getCpuTemperature(): Promise<number> {
  // Strategy 1: Read SMC keys directly (fast, ~10ms)
  const smc = await findSmc();
  if (smc) {
    let maxTemp = -1;
    for (const key of TEMP_KEYS) {
      try {
        const out = await $`${smc} -k ${key} -r`.text();
        if (!out.includes("no data")) {
          const t = parseSmcTemp(out);
          if (t > maxTemp) maxTemp = t;
        }
      } catch { /* skip */ }
    }
    if (maxTemp > 0) return maxTemp;
  }

  // Strategy 2: powermetrics (slow, ~1-2s, but comprehensive)
  try {
    const proc = Bun.spawn(
      ["powermetrics", "--samplers", "smc", "-i", "1000", "-n", "1"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const text = await new Response(proc.stdout).text();
    // Try multiple patterns - format varies between macOS versions
    const patterns = [
      /CPU die temperature:\s+([\d.]+)\s*C/,
      /CPU Th?e?r?m?a?l? ?l?e?v?e?l?.*?:\s+([\d.]+)\s*C/i,
      /die temperature.*?:\s+([\d.]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]!);
    }
  } catch { /* fallback */ }

  // Strategy 3: Battery temperature from ioreg (always available)
  try {
    const out = await $`ioreg -rc AppleSmartBattery`.text();
    const match = out.match(/"Temperature"\s*=\s*(\d+)/);
    if (match) {
      const temp = parseInt(match[1]!, 10) / 100;
      if (temp > 0 && temp < 150) return temp;
    }
  } catch { /* give up */ }

  return -1;
}

function getHelpersDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), "..", "helpers");
}

/**
 * Check that stress-ng is installed and GPU helper exists.
 */
export async function checkStressDependencies(): Promise<void> {
  try {
    const proc = Bun.spawn(["which", "stress-ng"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    if (!text.trim()) throw new Error();
  } catch {
    throw new Error(
      "stress-ng not found. Install it with: brew install stress-ng",
    );
  }

  // Check GPU helper exists
  const gpuHelper = resolve(getHelpersDir(), "gpu_stress");
  if (!(await Bun.file(gpuHelper).exists())) {
    throw new Error(
      `GPU stress helper not found at ${gpuHelper}.\n` +
      "  Run: npm run build:helpers",
    );
  }
}

/**
 * Start stress-ng on all CPU cores + GPU stress.
 */
export function startStress(): void {
  if (stressProc) return; // already running

  const cores = getCoreCount();

  // Start stress-ng with aggressive workloads on all cores
  stressProc = Bun.spawn(
    [
      "stress-ng",
      // CPU stress: heavy math on all cores
      "--cpu", String(cores),
      "--cpu-method", "all",
      // Matrix operations for ALU + cache stress
      "--matrix", "0",
      // Cache thrashing
      "--cache", "0",
      // Memory thrashing (locked in RAM to prevent SSD swap wear)
      "--vm", "2",
      "--vm-bytes", "256M",
      "--vm-keep",
      "--vm-locked",
      // Run forever until killed
      "--timeout", "0",
    ],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  // Start GPU stress
  const gpuHelper = resolve(getHelpersDir(), "gpu_stress");
  try {
    gpuProc = Bun.spawn([gpuHelper], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // GPU stress is optional - don't fail if it can't start
    gpuProc = null;
  }
}

/**
 * Stop all stress processes.
 */
export function stopStress(): void {
  if (stressProc) {
    stressProc.kill();
    stressProc = null;
  }
  if (gpuProc) {
    gpuProc.kill();
    gpuProc = null;
  }
}
