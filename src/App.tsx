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
const DISCLAIMER_EXIT_MESSAGES = [
  "Wise choice. Exiting.",
  "Probably for the best. Exiting.",
  "A rare moment of restraint. Exiting.",
  "Battery spared. Exiting.",
  "Cowardice or wisdom? Exiting.",
  "Your Mac lives another day. Exiting.",
  "Mercy has been granted. Exiting.",
  "No destruction today. Exiting.",
  "The battery thanks you. Exiting.",
  "Violence postponed. Exiting.",
  "Disaster averted. Exiting.",
  "This was the mature decision. Exiting.",
  "You've chosen peace. Exiting.",
  "The cells remain unpunished. Exiting.",
  "A surprising display of judgment. Exiting.",
  "Hardware abuse cancelled. Exiting.",
  "Your laptop gets a reprieve. Exiting.",
  "Cruelty deferred. Exiting.",
  "The fan noise will have to wait. Exiting.",
  "Battery torture skipped. Exiting.",
  "An act of compassion. Exiting.",
  "Sanity prevails. Exiting.",
  "The destroyer stands down. Exiting.",
  "A tactical retreat. Exiting.",
  "The machine escapes for now. Exiting.",
  "A disappointing lack of chaos. Exiting.",
  "You've denied history its moment. Exiting.",
  "The experiment dies before it begins. Exiting.",
  "Destruction remains theoretical. Exiting.",
  "Order has been restored. Exiting.",
] as const;
const CLEANUP_MESSAGES = [
  "All settings restored. Your MacBook has survived... for now.",
  "All settings restored. The battery lives to suffer another day.",
  "Cleanup complete. Your MacBook remains technically operational.",
  "Settings restored. The destroyer rests.",
  "All settings restored. No permanent crimes detected.",
  "Cleanup complete. The fans may now know peace.",
  "Settings restored. Your laptop has been returned to civilian mode.",
  "All settings restored. The battery endured the ritual.",
  "Cleanup complete. The torture chamber is now closed.",
  "Settings restored. Your MacBook escaped with dignity damage only.",
  "All settings restored. The hardware has filed no formal complaint.",
  "Cleanup complete. Normal service has resumed, more or less.",
  "Settings restored. The cells are shaken, but stable.",
  "All settings restored. Catastrophe has been postponed.",
  "Cleanup complete. The heat death of this laptop is delayed.",
  "Settings restored. The experiment is over. The trauma remains.",
  "All settings restored. Your MacBook may never emotionally recover.",
  "Cleanup complete. Battery abuse session concluded.",
  "Settings restored. The machine has survived your curiosity.",
  "All settings restored. Nothing is melting anymore.",
  "Cleanup complete. The battery has been released back into the wild.",
  "Settings restored. The silicon can unclench now.",
  "All settings restored. We have stopped making the problem worse.",
  "Cleanup complete. The laptop has been downgraded from victim to device.",
  "Settings restored. Mission accomplished, if you are very strange.",
  "All settings restored. The damage report is pending.",
  "Cleanup complete. Your MacBook has left the danger zone.",
  "Settings restored. The battery destroyer is off the clock.",
  "All settings restored. The machine survives to spin its fans again.",
  "Cleanup complete. The battery has seen things.",
] as const;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickRandomMessage(messages: readonly string[]): string {
  return messages[Math.floor(Math.random() * messages.length)] ?? "";
}

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
  const savedBrightness = useRef<number | null>(null);
  const savedSleep = useRef<SleepSettings>({
    battery: {
      displaysleep: 10,
      disksleep: 10,
      sleep: 1,
    },
    ac: {
      displaysleep: 10,
      disksleep: 10,
      sleep: 1,
    },
  });

  const startTimeRef = useRef<number>(0);
  const stoppingRef = useRef(false);
  const timerMinutesRef = useRef<number | null>(null);

  // Cleanup function: restore all settings
  const cleanup = useCallback(async (message?: string) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    setPhase("cleanup");
    stopStress();
    setStressActive(false);

    try {
      await enableCharging();
    } catch { /* best effort */ }

    if (savedBrightness.current != null) {
      try {
        await setBrightness(savedBrightness.current);
      } catch { /* best effort */ }
    }

    try {
      await restoreSleep(savedSleep.current);
    } catch { /* best effort */ }

    setDoneMessage(
      message ?? pickRandomMessage(CLEANUP_MESSAGES),
    );
    setAppState("done");

    // Give time to render the done message
    setTimeout(() => exit(), 1500);
  }, [exit]);

  // Handle Q / Ctrl+C during running state
  useInput(
    (input, key) => {
      if (appState === "running" && (input === "q" || input === "Q")) {
        void cleanup();
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
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      try {
        // 1. Save initial settings
        try {
          savedBrightness.current = await getBrightness();
        } catch {
          savedBrightness.current = null;
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
        await enableCharging();

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
              void cleanupRef.current();
            }
          }
        }, 1000);

        // Start CPU stress
        startStress();
        setStressActive(true);

        // Disable charging -> start discharging
        let currentPhase: "discharging" | "recharging" = "discharging";
        setPhase("discharging");
        await disableCharging();

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
            await enableCharging();
          } else if (currentPhase === "recharging" && info.percentage >= HIGH_THRESHOLD) {
            // Fully charged: increment cycle and switch to discharging
            currentCycles++;
            setCycleCount(currentCycles);
            currentPhase = "discharging";
            setPhase("discharging");
            await disableCharging();
          }

          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (error) {
        if (!cancelled && !stoppingRef.current) {
          try {
            await cleanup(
              `Stopped after error: ${formatError(error)}. Settings restored.`,
            );
          } catch {
            setDoneMessage(`Stopped after error: ${formatError(error)}`);
            setAppState("done");
          }
        }
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

    void run();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [appState]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Render based on state ===
  if (appState === "disclaimer") {
    return (
      <Disclaimer
        onAccept={() => setAppState("config")}
        onReject={() => {
          setDoneMessage(pickRandomMessage(DISCLAIMER_EXIT_MESSAGES));
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
