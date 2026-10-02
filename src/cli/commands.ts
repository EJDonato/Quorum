import { parseArgs } from "node:util";
import { initRepository } from "../application/init.js";
import {
  capabilityDiagnostics,
  inspectConfiguration,
  type ConfigurationPort,
} from "../application/inspect-config.js";
import { failure } from "../contracts/errors.js";

const unsupported = new Set([
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
        adapter: { type: "string" },
        mode: { type: "string" },
        model: { type: "string" },
        root: { type: "string" },
      },
    });
  } catch {
    return null;
  }
}

function help(json: boolean): CommandResult {
  const text =
    "Quorum foundation\nUsage: quorum [init|config|doctor|repl] [--config FILE] [--json]\nRunning quorum without arguments launches the interactive terminal.\ninit initializes .quorum/ configuration and persona templates;\nconfig validates configuration; doctor reports unverified capabilities.";
  return {
    exitCode: 0,
    json,
    text,
    body: { schema_version: "1.0.0", ok: true, help: text },
  };
}

async function handleInitCommand(
  args: NonNullable<ReturnType<typeof parse>>,
  json: boolean,
): Promise<CommandResult> {
  const adapterRaw = args.values.adapter;
  if (adapterRaw && adapterRaw !== "agy" && adapterRaw !== "codex") {
    return diagnostic(
      "INVALID_INPUT",
      "Adapter must be 'agy' or 'codex'.",
      json,
    );
  }
  const modeRaw = args.values.mode;
  if (modeRaw && modeRaw !== "enforced" && modeRaw !== "advisory") {
    return diagnostic(
      "INVALID_INPUT",
      "Mode must be 'enforced' or 'advisory'.",
      json,
    );
  }
  const result = await initRepository({
    rootDir: args.values.root,
    adapter: adapterRaw as "agy" | "codex" | undefined,
    mode: modeRaw as "enforced" | "advisory" | undefined,
    model: args.values.model,
  });
  if (!result.ok) {
    return {
      exitCode: 4,
      json,
      body: { schema_version: "1.0.0", ...result },
      text: result.error.message,
    };
  }
  const val = result.value;
  const configMsg = val.configCreated
    ? `Created configuration: ${val.configPath}`
    : `Preserved existing configuration: ${val.configPath}`;
  const text = [
    "Quorum initialized.",
    configMsg,
    `Persona templates: ${val.createdPersonas.length} created, ${val.preservedPersonas.length} preserved in ${val.agentsDir}`,
    val.disclosure,
  ].join("\n");
  return {
    exitCode: 0,
    json,
    body: { schema_version: "1.0.0", ok: true, ...val },
    text,
  };
}

interface ConfigDoctorOptions {
  command: "config" | "doctor";
  configFile?: string | undefined;
  port: ConfigurationPort;
  json: boolean;
}

async function handleConfigOrDoctorCommand(
  options: ConfigDoctorOptions,
): Promise<CommandResult> {
  const configuration = await inspectConfiguration(
    options.configFile ?? ".quorum/config.json",
    options.port,
  );
  if (!configuration.ok) {
    return {
      exitCode: configuration.error.code === "INVALID_INPUT" ? 2 : 4,
      json: options.json,
      body: { schema_version: "1.0.0", ...configuration },
      text: configuration.error.message,
    };
  }
  if (options.command === "config") {
    return {
      exitCode: 0,
      json: options.json,
      text: "Configuration is valid. Runtime readiness is unverified.",
      body: { schema_version: "1.0.0", ok: true, configuration_valid: true },
    };
  }
  const report = capabilityDiagnostics(configuration.value);
  return {
    exitCode: 3,
    json: options.json,
    body: { schema_version: "1.0.0", ok: false, ...report },
    text: "Configuration is valid. Runtime blocked: runner conformance, broker, isolation, usage limits, cancellation, and checks remain unverified.",
  };
}

export async function executeCommand(
  argv: string[],
  port: ConfigurationPort,
): Promise<CommandResult> {
  const args = parse(argv);
  if (!args) {
    return diagnostic(
      "INVALID_INPUT",
      "Invalid arguments. Use quorum --help.",
      argv.includes("--json"),
    );
  }
  const json = args.values.json ?? false;
  if (args.values.help || args.positionals.length === 0) return help(json);
  const command = args.positionals[0];
  if (command && unsupported.has(command)) {
    return diagnostic(
      "CAPABILITY_MISSING",
      `${command} is not implemented. No runner, workspace, or verified finalization is available.`,
      json,
    );
  }
  if (command === "init") {
    return handleInitCommand(args, json);
  }
  if (
    args.positionals.length !== 1 ||
    (command !== "config" && command !== "doctor")
  ) {
    return diagnostic(
      "INVALID_INPUT",
      "Unknown command or unexpected positional arguments. Use quorum --help.",
      json,
    );
  }
  return handleConfigOrDoctorCommand({
    command,
    configFile: args.values.config,
    port,
    json,
  });
}
