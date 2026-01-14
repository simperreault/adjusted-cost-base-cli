import React from "react";
import { Box, Text } from "ink";
import { PasswordInput } from "@inkjs/ui";

interface PasswordPromptProps {
  username: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ username, onSubmit }: PasswordPromptProps) {
  return (
    <Box flexDirection="column">
      <Text>Enter password for {username}:</Text>
      <Box marginTop={1}>
        <PasswordInput
          placeholder="Password..."
          onSubmit={onSubmit}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[Esc] Back to user selection</Text>
      </Box>
    </Box>
  );
}
