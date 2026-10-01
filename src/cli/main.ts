#!/usr/bin/env node
import { executeCommand } from "./commands.js";
import { present } from "./presentation.js";
import { readConfiguration } from "../infrastructure/configuration.js";

// Composition root. Imported modules never start processes or perform I/O.
const result = await executeCommand(process.argv.slice(2), {
  read: readConfiguration,
});
const output = present(result);
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = result.exitCode;
