import { $ } from "bun";

export interface BatteryInfo {
  percentage: number;
  isCharging: boolean;
  isPluggedIn: boolean;
  currentCapacity: number;
  maxCapacity: number;
  designCapacity: number;
  cycleCount: number;
  temperature: number; // Celsius
  healthPercent: number;
  wattage: number;
}

/**
 * Parse the output of `ioreg` to get battery information.
 * This is the most reliable way on Apple Silicon Macs.
 */
export async function getBatteryInfo(): Promise<BatteryInfo> {
  const result =
    await $`ioreg -rc AppleSmartBattery`.text();

  const getInt = (key: string): number => {
    const match = result.match(new RegExp(`"${key}"\\s*=\\s*(\\d+)`));
    return match ? parseInt(match[1]!, 10) : 0;
  };

  const getBool = (key: string): boolean => {
    const match = result.match(new RegExp(`"${key}"\\s*=\\s*(Yes|No)`));
    return match ? match[1] === "Yes" : false;
  };

  // On modern macOS, "CurrentCapacity" and "MaxCapacity" are percentages (0-100),
  // NOT milliamp-hours. The actual mAh values are in the "AppleRaw" variants.
  const currentCapacity = getInt("AppleRawCurrentCapacity");
  const maxCapacity = getInt("AppleRawMaxCapacity");
  const designCapacity = getInt("DesignCapacity");
  const cycleCount = getInt("CycleCount");
  const isCharging = getBool("IsCharging");
  const externalConnected = getBool("ExternalConnected");
  const temperature = getInt("Temperature") / 100; // reported in centi-celsius
  const wattage = getInt("Watts") || 0;

  // "CurrentCapacity" is the system percentage (0-100), use it directly
  const percentage = getInt("CurrentCapacity");
  const healthPercent =
    designCapacity > 0
      ? Math.round((maxCapacity / designCapacity) * 100)
      : 100;

  return {
    percentage,
    isCharging,
    isPluggedIn: externalConnected,
    currentCapacity,
    maxCapacity,
    designCapacity,
    cycleCount,
    temperature,
    healthPercent,
    wattage,
  };
}

/**
 * Wait until the charger is plugged in.
 * Polls every 2 seconds.
 */
export async function waitForCharger(
  signal?: AbortSignal,
): Promise<void> {
  while (!signal?.aborted) {
    const info = await getBatteryInfo();
    if (info.isPluggedIn) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
