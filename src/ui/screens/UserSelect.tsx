import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Select } from "@inkjs/ui";
import { listUsers, isPasswordProtected } from "../../services/userService.ts";
import { validateUsername } from "../../core/validation.ts";

interface UserSelectProps {
  onSelect: (username: string, needsPassword: boolean, isNew: boolean) => void;
}

export function UserSelect({ onSelect }: UserSelectProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [mode, setMode] = useState<"select" | "create">("select");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const userList = listUsers();
    setUsers(userList);
    if (userList.length === 0) {
      setMode("create");
    }
  }, []);

  useInput((input) => {
    if (input === "n" && mode === "select") {
      setMode("create");
      setError(null);
    }
  });

  const handleUserSelect = (value: string) => {
    const needsPassword = isPasswordProtected(value);
    onSelect(value, needsPassword, false);
  };

  const handleCreateSubmit = (value: string) => {
    const result = validateUsername(value);
    if (!result.success) {
      setError(result.error);
      return;
    }

    if (users.includes(result.value)) {
      setError("User already exists");
      return;
    }

    onSelect(result.value, false, true);
  };

  if (mode === "create" || users.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>Create a new user:</Text>
        <Box marginTop={1}>
          <Text color="gray">Username: </Text>
          <TextInput
            placeholder="Enter username..."
            onSubmit={handleCreateSubmit}
          />
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        {users.length > 0 && (
          <Box marginTop={1}>
            <Text color="gray">Press Escape to go back</Text>
          </Box>
        )}
      </Box>
    );
  }

  const options = users.map((u) => ({
    label: u + (isPasswordProtected(u) ? " (encrypted)" : ""),
    value: u,
  }));

  return (
    <Box flexDirection="column">
      <Text>Select a user:</Text>
      <Box marginTop={1}>
        <Select options={options} onChange={handleUserSelect} />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[N] Create new user | [Esc] Quit</Text>
      </Box>
    </Box>
  );
}
