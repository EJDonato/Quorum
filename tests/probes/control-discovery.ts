import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { captureProcess, type Capture } from "./process.js";
import {
  type ControlDiscovery,
  type ControlRunner,
  unverifiedObservations,
} from "./control-protocol.js";

type Step = ControlDiscovery["steps"][number];
type Features = ControlDiscovery["known_features"];
const emptyFeatures = (): Features => ({
  shell_tool: null,
  unified_exec: null,
  token_budget: null,
  rollout_budget: null,
});

async function digestExecutable(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    const value: unknown = chunk;
    if (!Buffer.isBuffer(value)) throw new Error("Invalid executable stream");
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

function step(id: Step["id"], capture: Capture): Step {
  return {
    id,
    attempted: true,
    exit_code: capture.exitCode,
    failure:
      capture.failure ?? (capture.exitCode === 0 ? null : "INVALID_PROTOCOL"),
  };
}

function featureRegistry(output: string): Features {
  const found = emptyFeatures();
  for (const name of Object.keys(found) as (keyof Features)[]) {
    const line = output.split("\n").find((item) => item.startsWith(`${name} `));
    if (!line) continue;
    const match = /\s(true|false)\s*$/.exec(line);
    if (match) found[name] = match[1] === "true";
  }
  return found;
}

async function boundedSchemaField(
  path: string,
  field: string,
): Promise<boolean> {
  const source = await readFile(path);
  if (source.length > 1_048_576)
    throw new Error("Oversized protocol definition");
  const value: unknown = JSON.parse(source.toString("utf8"));
  if (typeof value !== "object" || value === null || !("properties" in value))
    return false;
  const properties = value.properties;
  return (
    typeof properties === "object" && properties !== null && field in properties
  );
}

export interface ControlDiscoveryOptions {
  runner: ControlRunner;
  executable: string;
  expectedVersion: string;
  cwd: string;
  signal?: AbortSignal;
}

async function runStep(
  options: ControlDiscoveryOptions,
  executable: string,
  args: string[],
): Promise<Capture> {
  return captureProcess({
    executable,
    args,
    cwd: options.cwd,
    timeoutMs: 10_000,
    maxOutputBytes: 1_048_576,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function inspectCodex(
  options: ControlDiscoveryOptions,
  executable: string,
  report: ControlDiscovery,
): Promise<void> {
  const features = await runStep(options, executable, [
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
    "features",
    "list",
  ]);
  report.steps.push(step("features", features));
  if (features.exitCode === 0 && !features.interrupted)
    report.known_features = featureRegistry(features.stdout);
  const path = join(options.cwd, "protocol-schema");
  const generated = await runStep(options, executable, [
    "app-server",
    "generate-json-schema",
    "--experimental",
    "--out",
    path,
  ]);
  report.steps.push(step("protocol_schema", generated));
  if (generated.exitCode !== 0 || generated.interrupted) return;
  try {
    report.protocol_fields.dynamic_tools = await boundedSchemaField(
      join(path, "v2", "ThreadStartParams.json"),
      "dynamicTools",
    );
    report.protocol_fields.output_schema = await boundedSchemaField(
      join(path, "v2", "TurnStartParams.json"),
      "outputSchema",
    );
  } catch {
    const record = report.steps.at(-1);
    if (record) record.failure = "INVALID_PROTOCOL";
  }
}

// Read-only metadata discovery. It sends no prompt or model request.
export async function discoverControls(
  options: ControlDiscoveryOptions,
): Promise<ControlDiscovery> {
  const report: ControlDiscovery = {
    schema_version: "1.0.0",
    kind: "runner_control_metadata",
    runner: options.runner,
    expected_version: options.expectedVersion,
    observed_version: null,
    executable_digest: null,
    binary_unchanged: false,
    steps: [],
    known_features: emptyFeatures(),
    protocol_fields: { dynamic_tools: false, output_schema: false },
    capability_observations: unverifiedObservations(),
    enforced_conformance: false,
  };
  let executable: string;
  try {
    executable = await realpath(options.executable);
    report.executable_digest = await digestExecutable(executable);
  } catch {
    report.steps.push({
      id: "version",
      attempted: false,
      exit_code: null,
      failure: "LAUNCH_FAILED",
    });
    return report;
  }
  const version = await runStep(options, executable, ["--version"]);
  report.steps.push(step("version", version));
  const match = /^(?:codex-cli )?(\d+\.\d+\.\d+[\w.-]*)\s*$/.exec(
    version.stdout,
  );
  report.observed_version = match?.[1] ?? null;
  if (version.interrupted || version.exitCode !== 0) return report;
  if (report.observed_version === null) {
    const record = report.steps.at(-1);
    if (record) record.failure = "INVALID_PROTOCOL";
    return report;
  }
  if (report.observed_version !== options.expectedVersion) {
    const record = report.steps.at(-1);
    if (record) record.failure = "VERSION_MISMATCH";
    return report;
  }
  try {
    report.binary_unchanged =
      (await digestExecutable(executable)) === report.executable_digest;
  } catch {
    report.binary_unchanged = false;
  }
  if (!report.binary_unchanged) {
    const record = report.steps.at(-1);
    if (record) record.failure = "BINARY_CHANGED";
    return report;
  }
  const help = await runStep(
    options,
    executable,
    options.runner === "codex" ? ["exec", "--help"] : ["--help"],
  );
  report.steps.push(step("help", help));
  if (help.interrupted || help.exitCode !== 0) return report;
  if (options.runner === "codex")
    await inspectCodex(options, executable, report);
  try {
    report.binary_unchanged =
      (await digestExecutable(executable)) === report.executable_digest;
  } catch {
    report.binary_unchanged = false;
  }
  if (!report.binary_unchanged) {
    const record = report.steps.at(-1);
    if (record) record.failure = "BINARY_CHANGED";
  }
  return report;
}
