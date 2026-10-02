import { parseArgs } from "node:util";
import {
  capabilityDiagnostics,
  inspectConfiguration,
  type ConfigurationPort,
} from "../application/inspect-config.js";
import { failure } from "../contracts/errors.js";

const unsupported = new Set([
  "init",
  "run",
  "status",
  "diff",
  "resume",
  "cancel",
  "abort",
  "commit",
  "export",
  "clean",
  "dispatch",
]);

export interface CommandResult {
  exitCode: number;
  json: boolean;
  body: unknown;
  text: string;
}

function diagnostic(
  code: "INVALID_INPUT" | "CAPABILITY_MISSING",
  message: string,
  json: boolean,
): CommandResult {
  const result = failure(code, message);
  return {
    exitCode: code === "INVALID_INPUT" ? 2 : 3,
    json,
    body: { schema_version: "1.0.0", ...result },
    text: message,
  };
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        config: { type: "string" },
      },
    });
  } catch {
    return null;
  }
}

function help(json: boolean): CommandResult {
  const text =
    "Quorum foundation\nUsage: quorum [config|doctor|repl] [--config FILE] [--json]\nRunning quorum without arguments launches the interactive terminal.\nconfig validates configuration; doctor reports unverified capabilities.";
  return {
    exitCode: 0,
    json,
    text,
    body: { schema_version: "1.0.0", ok: true, help: text },
  };
}

export async function executeCommand(
  argv: string[],
  port: ConfigurationPort,
): Promise<CommandResult> {
  const args = parse(argv);
  if (!args)
    return diagnostic(
      "INVALID_INPUT",
      "Invalid arguments. Use quorum --help.",
      argv.includes("--json"),
    );
  const json = args.values.json ?? false;
  if (args.values.help || args.positionals.length === 0) return help(json);
  const command = args.positionals[0];
  if (command && unsupported.has(command))
    return diagnostic(
      "CAPABILITY_MISSING",
      `${command} is not implemented. No runner, workspace, or verified finalization is available.`,
      json,
    );
  if (
    args.positionals.length !== 1 ||
    (command !== "config" && command !== "doctor")
  )
    return diagnostic(
      "INVALID_INPUT",
      "Unknown command or unexpected positional arguments. Use quorum --help.",
      json,
    );
  const configuration = await inspectConfiguration(
    args.values.config ?? ".quorum/config.json",
    port,
  );
  if (!configuration.ok) {
    return {
      exitCode: configuration.error.code === "INVALID_INPUT" ? 2 : 4,
      json,
      body: { schema_version: "1.0.0", ...configuration },
      text: configuration.error.message,
    };
  }
  if (command === "config")
    return {
      exitCode: 0,
      json,
      text: "Configuration is valid. Runtime readiness is unverified.",
      body: { schema_version: "1.0.0", ok: true, configuration_valid: true },
    };
  const report = capabilityDiagnostics(configuration.value);
  return {
    exitCode: 3,
    json,
    body: { schema_version: "1.0.0", ok: false, ...report },
    text: "Configuration is valid. Runtime blocked: runner conformance, broker, isolation, usage limits, cancellation, and checks remain unverified.",
  };
}
