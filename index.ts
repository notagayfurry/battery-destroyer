#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./src/App.js";
import { enableCharging, checkChargingDependencies } from "./src/utils/charging.js";
import { stopStress, checkStressDependencies } from "./src/utils/cpu.js";
import {
  restoreSleep,
  getSleepSettings,
  type SleepSettings,
} from "./src/utils/sleep.js";
import { getBrightness, setBrightness, checkBrightnessDependencies } from "./src/utils/brightness.js";

// ── Sudo check ──────────────────────────────────────────────
if (process.getuid?.() !== 0) {
  console.error(
    "\x1b[31m✖ Battery Destroyer must be run as root.\x1b[0m\n" +
    "  Run with: sudo bun run index.ts\n",
  );
  process.exit(1);
}

// ── macOS check ─────────────────────────────────────────────
if (process.platform !== "darwin") {
  console.error(
    "\x1b[31m✖ Battery Destroyer only works on macOS.\x1b[0m\n",
  );
  process.exit(1);
}

// ── Dependency checks ───────────────────────────────────────
const depChecks = [
  checkChargingDependencies(),
  checkStressDependencies(),
  checkBrightnessDependencies(),
];

const depResults = await Promise.allSettled(depChecks);
const depErrors = depResults
  .filter((r): r is PromiseRejectedResult => r.status === "rejected")
  .map((r) => (r.reason as Error).message);

if (depErrors.length > 0) {
  for (const msg of depErrors) {
    console.error("\x1b[31m✖ Missing dependency:\x1b[0m " + msg);
  }
  console.error(
    "\n\x1b[33mInstall all dependencies:\x1b[0m\n" +
    "  brew install battery stress-ng\n" +
    "  npm run build:helpers\n",
  );
  process.exit(1);
}

// ── Emergency cleanup on uncaught errors / signals ──────────
let emergencySleepSettings: SleepSettings | null = null;
let emergencyBrightness: number | null = null;

// Capture initial settings before the app starts, for emergency restore
(async () => {
  try {
    emergencySleepSettings = await getSleepSettings();
  } catch { /* ignore */ }
  try {
    emergencyBrightness = await getBrightness();
  } catch { /* ignore */ }
})();

async function emergencyCleanup() {
  console.log("\n\x1b[33m⚠ Emergency cleanup...\x1b[0m");
  stopStress();

  try {
    await enableCharging();
  } catch { /* best effort */ }

  if (emergencySleepSettings) {
    try {
      await restoreSleep(emergencySleepSettings);
    } catch { /* best effort */ }
  }

  if (emergencyBrightness != null) {
    try {
      await setBrightness(emergencyBrightness);
    } catch { /* best effort */ }
  }

  console.log("\x1b[32m✔ Settings restored.\x1b[0m");
  process.exit(0);
}

process.on("SIGINT", emergencyCleanup);
process.on("SIGTERM", emergencyCleanup);
process.on("uncaughtException", async (err) => {
  console.error("\x1b[31mUncaught exception:\x1b[0m", err);
  await emergencyCleanup();
});

// ── Render the app ──────────────────────────────────────────
const { waitUntilExit } = render(React.createElement(App));
await waitUntilExit();
