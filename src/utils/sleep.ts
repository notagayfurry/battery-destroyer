import { $ } from "bun";

/**
 * Manage macOS sleep settings using `caffeinate` and `pmset`.
 */

let caffeinateProc: ReturnType<typeof Bun.spawn> | null = null;

export interface SleepSettings {
  displaysleep: number;
  disksleep: number;
  sleep: number;
}

/**
 * Get current sleep settings so we can restore them later.
 */
export async function getSleepSettings(): Promise<SleepSettings> {
  const out = await $`pmset -g custom`.text();

  const getVal = (key: string): number => {
    // Look in Battery Power section first, then AC
    const match = out.match(new RegExp(`${key}\\s+(\\d+)`));
    return match ? parseInt(match[1]!, 10) : 0;
  };

  return {
    displaysleep: getVal("displaysleep"),
    disksleep: getVal("disksleep"),
    sleep: getVal("sleep"),
  };
}

/**
 * Disable all sleep (display sleep, disk sleep, system sleep).
 * Also launches `caffeinate` to prevent sleep assertions.
 */
export async function disableSleep(): Promise<void> {
  // Set all sleep timers to 0 (never sleep)
  await $`pmset -a displaysleep 0`.quiet();
  await $`pmset -a disksleep 0`.quiet();
  await $`pmset -a sleep 0`.quiet();

  // Launch caffeinate to assert "no sleep" at the IOKit level
  if (!caffeinateProc) {
    caffeinateProc = Bun.spawn(["caffeinate", "-dims"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }
}

/**
 * Restore sleep settings to the given values.
 */
export async function restoreSleep(settings: SleepSettings): Promise<void> {
  // Kill caffeinate first
  if (caffeinateProc) {
    caffeinateProc.kill();
    caffeinateProc = null;
  }

  await $`pmset -a displaysleep ${settings.displaysleep}`.quiet();
  await $`pmset -a disksleep ${settings.disksleep}`.quiet();
  await $`pmset -a sleep ${settings.sleep}`.quiet();
}
