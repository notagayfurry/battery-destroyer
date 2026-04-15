import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface RunConfig {
  timerMinutes: number | null; // null = no timer (manual stop)
}

interface ConfigProps {
  onStart: (config: RunConfig) => void;
  onBack: () => void;
}

const TIMER_OPTIONS = [
  { label: "No timer (manual stop)", value: null },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "4 hours", value: 240 },
  { label: "8 hours", value: 480 },
  { label: "12 hours", value: 720 },
  { label: "24 hours", value: 1440 },
] as const;

export function Config({ onStart, onBack }: ConfigProps) {
  const [selectedTimer, setSelectedTimer] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedTimer((s) => Math.max(0, s - 1));
    }
    if (key.downArrow) {
      setSelectedTimer((s) => Math.min(TIMER_OPTIONS.length - 1, s + 1));
    }
    if (key.return) {
      onStart({
        timerMinutes: TIMER_OPTIONS[selectedTimer]!.value,
      });
    }
    if (input === "q" || key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {"⚡ CONFIGURATION"}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Select a timer (or run until manually stopped):</Text>
        <Text> </Text>
        {TIMER_OPTIONS.map((opt, i) => (
          <Box key={i}>
            <Text
              color={i === selectedTimer ? "cyan" : "white"}
              bold={i === selectedTimer}
            >
              {i === selectedTimer ? " ❯ " : "   "}
              {opt.label}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Use ↑ ↓ to select, Enter to start, Q to go back
        </Text>
      </Box>
    </Box>
  );
}
