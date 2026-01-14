#!/usr/bin/env bun

import { render } from "ink";
import React from "react";
import { createCLI, hasInlineCommands } from "./cli/index.ts";
import { App } from "./ui/App.tsx";

const args = process.argv.slice(2);

if (hasInlineCommands(args)) {
  const program = createCLI();
  program.parse();
} else {
  // Extract --user if provided for TUI startup
  const userIndex = args.indexOf("--user");
  const initialUser =
    userIndex !== -1 && args[userIndex + 1] ? args[userIndex + 1] : undefined;

  render(React.createElement(App, { initialUser }));
}
