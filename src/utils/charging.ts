import { $ } from "bun";

/**
 * Control battery charging on Apple Silicon Macs.
 *
 * On macOS Sequoia (and Ventura+), `pmset -a charging 0/1` no longer works.
 * Apple removed the pmset charging flag. The only reliable way to control
 * charging is through direct SMC key manipulation.
 *
 * We use the `smc` binary (from the battery CLI tool) to write SMC keys.
 * Install with: brew install battery
 *
 * Two separate mechanisms:
 *
 * 1. Charging control (CHTE / CH0B+CH0C):
 *    Tells the battery whether to accept charge.
 *    With charging disabled, the adapter STILL powers the system - the battery
 *    just won't charge. This means the battery won't drain while plugged in.
 *
 * 2. Force-discharge / adapter control (CHIE / CH0I / CH0J):
 *    Forces the system to run on battery even when the adapter is plugged in.
 *    This is required to actually drain the battery while the cable is connected.
 *
 * To drain the battery while plugged in, you need BOTH:
 *   - Disable charging (so the battery doesn't recharge)
 *   - Enable force-discharge (so the system draws from battery, not adapter)
 */

const SMC_BINARY = "/usr/local/co.palokaj.battery/smc";
const SMC_BINARY_ALT = "/usr/local/bin/smc";

let resolvedSmcBinary: string | null = null;

async function findSmcBinary(): Promise<string> {
  if (resolvedSmcBinary) return resolvedSmcBinary;

  for (const path of [SMC_BINARY, SMC_BINARY_ALT]) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        resolvedSmcBinary = path;
        return path;
      }
    } catch { /* continue */ }
  }

  throw new Error(
    "smc binary not found. Install the battery CLI with: brew install battery\n" +
    "  See: https://github.com/actuallymentor/battery",
  );
}

/**
 * Check if the required tools are available.
 * Should be called at startup to fail early with a helpful message.
 */
export async function checkChargingDependencies(): Promise<void> {
  await findSmcBinary();
}

/**
 * Detect which SMC keys are supported on this machine.
 */
async function detectSmcKeys(): Promise<{
  tahoe: boolean;
  legacy: boolean;
  chie: boolean;
  ch0i: boolean;
  ch0j: boolean;
}> {
  const smc = await findSmcBinary();

  const readKey = async (key: string): Promise<boolean> => {
    try {
      const result = await $`${smc} -k ${key} -r`.text();
      return !result.includes("no data") && !result.includes("Error");
    } catch {
      return false;
    }
  };

  const [tahoe, legacy, chie, ch0i, ch0j] = await Promise.all([
    readKey("CHTE"),
    readKey("CH0B"),
    readKey("CHIE"),
    readKey("CH0I"),
    readKey("CH0J"),
  ]);

  return { tahoe, legacy, chie, ch0i, ch0j };
}

let cachedKeys: Awaited<ReturnType<typeof detectSmcKeys>> | null = null;

async function getSmcKeys() {
  if (!cachedKeys) {
    cachedKeys = await detectSmcKeys();
  }
  return cachedKeys;
}

async function smcWrite(key: string, value: string): Promise<void> {
  const smc = await findSmcBinary();
  await $`${smc} -k ${key} -w ${value}`.quiet();
}

// ── Force-discharge (adapter control) ───────────────────────

/**
 * Enable force-discharge: system runs on battery even when adapter is plugged in.
 * This effectively "disconnects" the adapter from powering the system.
 */
async function enableForceDischarge(): Promise<void> {
  const keys = await getSmcKeys();

  if (keys.chie) {
    await smcWrite("CHIE", "08");
  } else if (keys.ch0j) {
    await smcWrite("CH0J", "01");
  } else if (keys.ch0i) {
    await smcWrite("CH0I", "01");
  } else {
    throw new Error(
      "Unable to determine SMC keys for force-discharge on this machine.",
    );
  }

  // Set MagSafe LED to indicate we're on battery
  try {
    await smcWrite("ACLC", "01");
  } catch { /* non-critical */ }
}

/**
 * Disable force-discharge: allow the adapter to power the system again.
 */
async function disableForceDischarge(): Promise<void> {
  const keys = await getSmcKeys();

  if (keys.chie) {
    await smcWrite("CHIE", "00");
  } else if (keys.ch0j) {
    await smcWrite("CH0J", "00");
  } else if (keys.ch0i) {
    await smcWrite("CH0I", "00");
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Stop charging and force the system onto battery power.
 * This is what you call when you want the battery to DRAIN while plugged in.
 *
 * Does two things:
 * 1. Disables charging (battery won't accept charge)
 * 2. Enables force-discharge (system runs on battery, not adapter)
 */
export async function disableCharging(): Promise<void> {
  const keys = await getSmcKeys();

  // Step 1: Disable charging
  if (keys.tahoe) {
    await smcWrite("CHTE", "01000000");
  } else if (keys.legacy) {
    await smcWrite("CH0B", "02");
    await smcWrite("CH0C", "02");
  } else {
    throw new Error(
      "Unable to determine SMC keys for disabling charging on this machine.",
    );
  }

  // Step 2: Force-discharge so the battery actually drains
  await enableForceDischarge();
}

/**
 * Re-enable charging and let the adapter power the system.
 * This is what you call when you want the battery to CHARGE.
 *
 * Does two things:
 * 1. Disables force-discharge (adapter powers the system again)
 * 2. Enables charging (battery accepts charge)
 */
export async function enableCharging(): Promise<void> {
  const keys = await getSmcKeys();

  // Step 1: Disable force-discharge first (let adapter provide power)
  await disableForceDischarge();

  // Step 2: Enable charging
  if (keys.tahoe) {
    await smcWrite("CHTE", "00000000");
  } else if (keys.legacy) {
    await smcWrite("CH0B", "00");
    await smcWrite("CH0C", "00");
  } else {
    throw new Error(
      "Unable to determine SMC keys for enabling charging on this machine.",
    );
  }

  // Reset MagSafe LED
  try {
    await smcWrite("ACLC", "00");
  } catch { /* non-critical */ }
}
