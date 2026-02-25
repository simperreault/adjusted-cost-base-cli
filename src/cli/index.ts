import { Command } from "commander";
import { buyCommand } from "./commands/buy.ts";
import { sellCommand } from "./commands/sell.ts";
import { listCommand } from "./commands/list.ts";
import { auditCommand } from "./commands/audit.ts";
import { distributionCommand } from "./commands/distribution.ts";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("acb-cli")
    .description("Adjusted Cost Base tracking CLI for Canadian stock trading")
    .version("0.1.0");

  program.addCommand(buyCommand);
  program.addCommand(sellCommand);
  program.addCommand(listCommand);
  program.addCommand(auditCommand);
  program.addCommand(distributionCommand);

  return program;
}

export function hasInlineCommands(args: string[]): boolean {
  const commands = ["buy", "sell", "list", "audit", "distribution"];
  return args.some((arg) => commands.includes(arg));
}
