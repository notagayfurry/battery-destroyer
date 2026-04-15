import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Disclaimer } from "./components/Disclaimer.js";
import { Config, type RunConfig } from "./components/Config.js";
import { Dashboard, type Phase } from "./components/Dashboard.js";
import { getBatteryInfo, type BatteryInfo } from "./utils/battery.js";
import { enableCharging, disableCharging } from "./utils/charging.js";
import { setBrightness, getBrightness } from "./utils/brightness.js";
import {
  disableSleep,
  restoreSleep,
  getSleepSettings,
  type SleepSettings,
} from "./utils/sleep.js";
import {
  startStress,
  stopStress,
  getCoreCount,
  getCpuUsage,
  getCpuTemperature,
} from "./utils/cpu.js";

type AppState = "disclaimer" | "config" | "running" | "done";

const LOW_THRESHOLD = 5;
const HIGH_THRESHOLD = 100;

export function App() {
  const { exit } = useApp();

  const [appState, setAppState] = useState<AppState>("disclaimer");
  const [phase, setPhase] = useState<Phase>("waiting_charger");
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [cpuTemp, setCpuTemp] = useState(0);
  const [cpuUsage, setCpuUsage] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [stressActive, setStressActive] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [timerRemainingMs, setTimerRemainingMs] = useState<number | null>(null);
  const [doneMessage, setDoneMessage] = useState("");

  // Saved initial settings for cleanup
  const savedBrightness = useRef<number>(0.5);
  const savedSleep = useRef<SleepSettings>({
    displaysleep: 10,
    disksleep: 10,
    sleep: 1,
  });

  const startTimeRef = useRef<number>(0);
  const stoppingRef = useRef(false);
  const timerMinutesRef = useRef<number | null>(null);

  // Cleanup function: restore all settings
  const cleanup = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    setPhase("cleanup");
    stopStress();
    setStressActive(false);

    try {
      await enableCharging();
    } catch { /* best effort */ }

    try {
      await setBrightness(savedBrightness.current);
    } catch { /* best effort */ }

    try {
      await restoreSleep(savedSleep.current);
    } catch { /* best effort */ }

    setDoneMessage(
      "All settings restored. Your MacBook has survived... for now.",
    );
    setAppState("done");

    // Give time to render the done message
    setTimeout(() => exit(), 1500);
  }, [exit]);

  // Handle Q / Ctrl+C during running state
  useInput(
    (input, key) => {
      if (appState === "running" && (input === "q" || input === "Q")) {
        cleanup();
      }
    },
  );

  // Store cleanup in a ref so the interval can access the latest version
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  // === MAIN LOOP (runs when appState === "running") ===
  useEffect(() => {
    if (appState !== "running") return;

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval>;
    let timerInterval: ReturnType<typeof setInterval>;

    const run = async () => {
      // 1. Save initial settings
      try {
        savedBrightness.current = await getBrightness();
      } catch {
        savedBrightness.current = 0.5;
      }
      try {
        savedSleep.current = await getSleepSettings();
      } catch { /* use defaults */ }

      // 2. Disable sleep (brightness set later after charger is disconnected)
      try {
        await disableSleep();
      } catch { /* non-fatal */ }

      // 3. Check if charger is plugged in
      setPhase("waiting_charger");
      let info = await getBatteryInfo();
      setBattery(info);

      while (!info.isPluggedIn && !cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        info = await getBatteryInfo();
        setBattery(info);
      }
      if (cancelled) return;

      // 4. Enable charging and wait for 100%
      setPhase("initial_charge");
      try {
        await enableCharging();
      } catch { /* may already be enabled */ }

      while (!cancelled) {
        info = await getBatteryInfo();
        setBattery(info);
        if (info.percentage >= HIGH_THRESHOLD) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (cancelled) return;

      // 5. Start the destroy loop
      startTimeRef.current = Date.now();

      // Start timing
      timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedMs(elapsed);

        const tm = timerMinutesRef.current;
        if (tm != null) {
          const remaining = tm * 60 * 1000 - elapsed;
          setTimerRemainingMs(Math.max(0, remaining));
          if (remaining <= 0) {
            cleanupRef.current();
          }
        }
      }, 1000);

      // Start CPU stress
      startStress();
      setStressActive(true);

      // Disable charging -> start discharging
      let currentPhase: "discharging" | "recharging" = "discharging";
      setPhase("discharging");
      try {
        await disableCharging();
      } catch (e) {
        // If we can't disable charging, this is fatal for the loop
        setDoneMessage(`Error: Could not disable charging: ${e}`);
        setAppState("done");
        return;
      }

      // Set brightness to max AFTER disabling charger (needs a short delay
      // to take effect properly on Apple Silicon)
      await new Promise((r) => setTimeout(r, 3500));
      try {
        await setBrightness(1.0);
      } catch { /* non-fatal */ }

      // Main cycle loop
      let currentCycles = 0;

      while (!cancelled && !stoppingRef.current) {
        info = await getBatteryInfo();
        setBattery(info);

        if (currentPhase === "discharging" && info.percentage <= LOW_THRESHOLD) {
          // Hit the low threshold! Switch to charging
          currentPhase = "recharging";
          setPhase("recharging");
          try {
            await enableCharging();
          } catch { /* best effort */ }
        } else if (currentPhase === "recharging" && info.percentage >= HIGH_THRESHOLD) {
          // Fully charged: increment cycle and switch to discharging
          currentCycles++;
          setCycleCount(currentCycles);
          currentPhase = "discharging";
          setPhase("discharging");
          try {
            await disableCharging();
          } catch { /* best effort */ }
        }

        await new Promise((r) => setTimeout(r, 5000));
      }
    };

    // Start the polling for CPU stats (independent of the main loop)
    pollInterval = setInterval(async () => {
      try {
        const usage = await getCpuUsage();
        setCpuUsage(usage);
      } catch { /* ignore */ }

      try {
        const temp = await getCpuTemperature();
        setCpuTemp(temp);
      } catch { /* ignore */ }
    }, 5000);

    run();

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      clearInterval(timerInterval!);
    };
  }, [appState]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Render based on state ===
  if (appState === "disclaimer") {
    return (
      <Disclaimer
        onAccept={() => setAppState("config")}
        onReject={() => {
          setDoneMessage("Wise choice. Exiting.");
          setAppState("done");
          setTimeout(() => exit(), 500);
        }}
      />
    );
  }

  if (appState === "config") {
    return (
      <Config
        onStart={(config: RunConfig) => {
          setTimerMinutes(config.timerMinutes);
          timerMinutesRef.current = config.timerMinutes;
          setAppState("running");
        }}
        onBack={() => setAppState("disclaimer")}
      />
    );
  }

  if (appState === "done") {
    return (
      <Box padding={1}>
        <Text color="cyan">{doneMessage}</Text>
      </Box>
    );
  }

  // Running state
  return (
    <Dashboard
      phase={phase}
      battery={battery}
      cpuTemp={cpuTemp}
      cpuUsage={cpuUsage}
      coreCount={getCoreCount()}
      cycleCount={cycleCount}
      stressActive={stressActive}
      elapsedMs={elapsedMs}
      timerMinutes={timerMinutes}
      timerRemainingMs={timerRemainingMs}
    />
  );
}
