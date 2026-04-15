import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface DisclaimerProps {
  onAccept: () => void;
  onReject: () => void;
}

export function Disclaimer({ onAccept, onReject }: DisclaimerProps) {
  const [selected, setSelected] = useState(0); // 0 = reject, 1 = accept

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setSelected((s) => (s === 0 ? 1 : 0));
    }
    if (key.return) {
      if (selected === 1) {
        onAccept();
      } else {
        onReject();
      }
    }
    if (input === "q" || key.escape) {
      onReject();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="red">
          {"⚠  BATTERY DESTROYER - WARNING ⚠"}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">
          This program is designed to aggressively cycle your MacBook battery
        </Text>
        <Text color="yellow">
          between 5% and 100% while running maximum CPU stress tests.
        </Text>
        <Text> </Text>
        <Text bold color="red">
          This WILL cause:
        </Text>
        <Text color="white">  - Significant battery degradation and reduced lifespan</Text>
        <Text color="white">  - Extreme heat generation</Text>
        <Text color="white">  - Potential thermal throttling</Text>
        <Text color="white">  - Increased fan noise and wear</Text>
        <Text color="white">  - Possible hardware damage in extreme cases</Text>
        <Text> </Text>
        <Text bold color="red">
          The author(s) of this software accept NO responsibility for any
        </Text>
        <Text bold color="red">
          damage caused to your hardware. Use entirely at your own risk.
        </Text>
        <Text> </Text>
        <Text dimColor>
          By accepting, you acknowledge that you understand the risks and
        </Text>
        <Text dimColor>
          waive all claims against the creators of this software.
        </Text>
      </Box>

      <Box gap={2}>
        <Box>
          <Text
            bold
            color={selected === 0 ? "white" : "gray"}
            backgroundColor={selected === 0 ? "blueBright" : undefined}
          >
            {" DECLINE & EXIT "}
          </Text>
        </Box>
        <Box>
          <Text
            bold
            color={selected === 1 ? "white" : "gray"}
            backgroundColor={selected === 1 ? "red" : undefined}
          >
            {" I ACCEPT THE RISKS "}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Use ← → to select, Enter to confirm, Q to quit
        </Text>
      </Box>
    </Box>
  );
}
