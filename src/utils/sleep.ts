import { $ } from "bun";

/**
 * Manage macOS sleep settings using `caffeinate` and `pmset`.
 */

let caffeinateProc: ReturnType<typeof Bun.spawn> | null = null;

interface PowerSleepSettings {
  displaysleep: number;
  disksleep: number;
  sleep: number;
}

export interface SleepSettings {
  battery: PowerSleepSettings;
  ac: PowerSleepSettings;
}

const DEFAULT_SLEEP_SETTINGS: PowerSleepSettings = {
  displaysleep: 10,
  disksleep: 10,
  sleep: 1,
};

function extractPmsetSection(output: string, header: string): string {
  const marker = `${header}:\n`;
  const start = output.indexOf(marker);
  if (start === -1) return "";

  const remainder = output.slice(start + marker.length);
  const nextSectionStart = remainder.search(/\n[A-Za-z][A-Za-z ]*:\n/);
  return nextSectionStart === -1
    ? remainder
    : remainder.slice(0, nextSectionStart);
}

function parsePowerSettings(section: string): PowerSleepSettings {
  const getVal = (key: keyof PowerSleepSettings): number => {
    const match = section.match(new RegExp(`\\b${key}\\s+(\\d+)`));
    return match
      ? parseInt(match[1]!, 10)
      : DEFAULT_SLEEP_SETTINGS[key];
  };

  return {
    displaysleep: getVal("displaysleep"),
    disksleep: getVal("disksleep"),
    sleep: getVal("sleep"),
  };
}

/**
 * Get current sleep settings so we can restore them later.
 */
export async function getSleepSettings(): Promise<SleepSettings> {
  const out = await $`pmset -g custom`.text();
  const batterySection = extractPmsetSection(out, "Battery Power");
  const acSection = extractPmsetSection(out, "AC Power");

  return {
    battery: parsePowerSettings(batterySection || out),
    ac: parsePowerSettings(acSection || out),
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

  await $`pmset -b displaysleep ${settings.battery.displaysleep}`.quiet();
  await $`pmset -b disksleep ${settings.battery.disksleep}`.quiet();
  await $`pmset -b sleep ${settings.battery.sleep}`.quiet();

  await $`pmset -c displaysleep ${settings.ac.displaysleep}`.quiet();
  await $`pmset -c disksleep ${settings.ac.disksleep}`.quiet();
  await $`pmset -c sleep ${settings.ac.sleep}`.quiet();
}
