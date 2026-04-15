import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { BatteryInfo } from "../utils/battery.js";

export type Phase =
  | "waiting_charger"
  | "initial_charge"
  | "discharging"
  | "recharging"
  | "stopping"
  | "cleanup";

interface DashboardProps {
  phase: Phase;
  battery: BatteryInfo | null;
  cpuTemp: number;
  cpuUsage: number;
  coreCount: number;
  cycleCount: number;
  stressActive: boolean;
  elapsedMs: number;
  timerMinutes: number | null;
  timerRemainingMs: number | null;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function batteryBar(pct: number): string {
  const width = 30;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "waiting_charger":
      return "Waiting for charger...";
    case "initial_charge":
      return "Initial charge to 100%";
    case "discharging":
      return "Discharging (stress active)";
    case "recharging":
      return "Recharging to 100% (stress active)";
    case "stopping":
      return "Stopping...";
    case "cleanup":
      return "Restoring settings...";
  }
}

function phaseColor(phase: Phase): string {
  switch (phase) {
    case "waiting_charger":
      return "yellow";
    case "initial_charge":
      return "green";
    case "discharging":
      return "red";
    case "recharging":
      return "blue";
    case "stopping":
      return "yellow";
    case "cleanup":
      return "cyan";
  }
}

function tempColor(temp: number): string {
  if (temp < 0) return "gray";
  if (temp < 60) return "green";
  if (temp < 80) return "yellow";
  return "red";
}

function batteryColor(pct: number): string {
  if (pct <= 10) return "red";
  if (pct <= 30) return "yellow";
  return "green";
}

export function Dashboard({
  phase,
  battery,
  cpuTemp,
  cpuUsage,
  coreCount,
  cycleCount,
  stressActive,
  elapsedMs,
  timerMinutes,
  timerRemainingMs,
}: DashboardProps) {
  const pct = battery?.percentage ?? 0;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="red">
          {"🔥 BATTERY DESTROYER 🔥"}
        </Text>
      </Box>

      {/* Phase indicator */}
      <Box marginBottom={1}>
        <Text>
          <Spinner type="dots" />
        </Text>
        <Text bold color={phaseColor(phase) as any}>
          {"  "}
          {phaseLabel(phase)}
        </Text>
      </Box>

      {/* Battery section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Battery</Text>
        <Box>
          <Text color={batteryColor(pct) as any}>
            {"  "}
            {batteryBar(pct)} {pct}%
          </Text>
        </Box>
        <Text>
          {"  "}State:{" "}
          <Text color={battery?.isCharging ? "green" : "red"}>
            {battery?.isCharging ? "⚡ Charging" : "🔋 Discharging"}
          </Text>
          {"  "}Plugged in:{" "}
          <Text color={battery?.isPluggedIn ? "green" : "red"}>
            {battery?.isPluggedIn ? "Yes" : "No"}
          </Text>
        </Text>
        <Text>
          {"  "}Capacity: {battery?.currentCapacity ?? "?"} / {battery?.maxCapacity ?? "?"} mAh
          {"  "}Design: {battery?.designCapacity ?? "?"} mAh
        </Text>
        <Text>
          {"  "}Health:{" "}
          <Text color={((battery?.healthPercent ?? 100) < 80) ? "red" : "green"}>
            {battery?.healthPercent ?? "?"}%
          </Text>
          {"  "}System cycles: {battery?.cycleCount ?? "?"}
          {"  "}Temp:{" "}
          <Text color={tempColor(battery?.temperature ?? -1) as any}>
            {battery?.temperature ? `${battery.temperature.toFixed(1)}°C` : "N/A"}
          </Text>
        </Text>
      </Box>

      {/* CPU + GPU section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Stress (CPU + GPU)</Text>
        <Text>
          {"  "}CPU:{" "}
          <Text color={stressActive ? "red" : "gray"}>
            {stressActive ? `stress-ng on ${coreCount} cores` : "Idle"}
          </Text>
        </Text>
        <Text>
          {"  "}GPU:{" "}
          <Text color={stressActive ? "red" : "gray"}>
            {stressActive ? "Metal compute shader ACTIVE" : "Idle"}
          </Text>
        </Text>
        <Text>
          {"  "}Load: {cpuUsage}%{"  "}
          Temperature:{" "}
          <Text color={tempColor(cpuTemp) as any}>
            {cpuTemp > 0 ? `${cpuTemp.toFixed(1)}°C` : "N/A"}
          </Text>
        </Text>
      </Box>

      {/* Stats section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Session</Text>
        <Text>
          {"  "}Destroy cycles completed:{" "}
          <Text bold color="magenta">{cycleCount}</Text>
        </Text>
        <Text>
          {"  "}Elapsed: {formatDuration(elapsedMs)}
        </Text>
        {timerMinutes != null && (
          <Text>
            {"  "}Timer remaining:{" "}
            <Text color={(timerRemainingMs ?? 0) < 60000 ? "red" : "white"}>
              {timerRemainingMs != null ? formatDuration(timerRemainingMs) : "N/A"}
            </Text>
          </Text>
        )}
      </Box>

      {/* Controls */}
      <Box>
        <Text dimColor>
          Press Q or Ctrl+C to stop and restore settings
        </Text>
      </Box>
    </Box>
  );
}
