#!/usr/bin/env node
import { executeCommand } from "./commands.js";
import { present } from "./presentation.js";
import { readConfiguration } from "../infrastructure/configuration.js";
import { startRepl } from "./repl.js";

// Composition root.
const args = process.argv.slice(2);
const shouldStartRepl =
  (args.length === 0 && Boolean(process.stdin.isTTY)) ||
  args[0] === "repl" ||
  args[0] === "interactive";

if (shouldStartRepl) {
  await startRepl({
    readConfig: readConfiguration,
  });
} else {
  const result = await executeCommand(args, {
    read: readConfiguration,
  });
  const output = present(result);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  process.exitCode = result.exitCode;
}
