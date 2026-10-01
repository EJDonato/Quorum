import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { captureProcess, type Capture } from "./process.js";
import { probeArguments, validateProbe, type Runner } from "./protocol.js";

async function executableDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    const value: unknown = chunk;
    if (!Buffer.isBuffer(value)) throw new Error("Invalid binary stream");
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

// Only fixed categories survive capture. No provider text, paths, or secrets.
function diagnostics(capture: Capture): string[] {
  const text = capture.stderr + "\n" + capture.stdout;
  const patterns: [string, RegExp][] = [
    [
      "SANDBOX_DENIED",
      /operation not permitted|permission denied|bind:.*permitted/i,
    ],
    [
      "MODEL_UNAVAILABLE",
      /model.*(?:not supported|not available|does not exist|access)|unsupported model/i,
    ],
    [
      "AUTHENTICATION",
      /unauthori[sz]ed|authentication failed|not logged in|failed to retrieve token/i,
    ],
    [
      "NETWORK_FAILED",
      /ENOTFOUND|failed to connect|connection refused|error sending request/i,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

export interface ProbeOptions {
  runner: Runner;
  model: string;
  executable: string;
  expectedVersion: string;
  cwd: string;
  schemaPath: string;
  signal?: AbortSignal;
}

export interface ProbeReport {
  schema_version: string;
  kind: string;
  recorded_at: string;
  runner: Runner;
  expected_version: string;
  runner_version: string | null;
  version_exit_code: number | null;
  executable_digest: string | null;
  requested_model: string;
  model_identity_verified: boolean;
  timeout_ms: number;
  max_output_bytes: number;
  attempts: number;
  enforced_conformance: boolean;
  cleanup_confirmed: boolean;
  hard_token_ceiling: boolean;
  usage_accounting_complete: boolean;
  exit_code: number | null;
  execution_failure: string | null;
  diagnostic_codes: string[];
  timings_ms: {
    version_discovery: number | null;
    invocation: number | null;
    total: number;
  };
  result: ReturnType<typeof validateProbe>;
}

function initialReport(options: ProbeOptions): ProbeReport {
  return {
    schema_version: "1.1.0",
    kind: "structured_output_smoke",
    recorded_at: new Date().toISOString(),
    runner: options.runner,
    expected_version: options.expectedVersion,
    runner_version: null,
    version_exit_code: null,
    executable_digest: null,
    requested_model: options.model,
    model_identity_verified: false,
    timeout_ms: 60_000,
    max_output_bytes: 1_048_576,
    attempts: 0,
    enforced_conformance: false,
    cleanup_confirmed: false,
    hard_token_ceiling: false,
    usage_accounting_complete: false,
    exit_code: null,
    execution_failure: null,
    diagnostic_codes: [],
    timings_ms: { version_discovery: null, invocation: null, total: 0 },
    result: { ok: false, reason: "EXECUTION_FAILED" },
  };
}

async function versionMatches(
  options: ProbeOptions,
  report: ProbeReport,
): Promise<boolean> {
  const started = performance.now();
  const version = await captureProcess({
    executable: options.executable,
    args: ["--version"],
    cwd: options.cwd,
    timeoutMs: 10_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  report.timings_ms.version_discovery = Math.round(performance.now() - started);
  const match = /^(?:codex-cli )?(\d+\.\d+\.\d+[\w.-]*)\s*$/.exec(
    version.stdout,
  );
  report.runner_version = match?.[1] ?? null;
  report.version_exit_code = version.exitCode;
  report.diagnostic_codes = diagnostics(version);
  if (
    version.interrupted ||
    version.exitCode !== 0 ||
    report.runner_version === null
  ) {
    report.execution_failure = version.failure ?? "VERSION_DISCOVERY_FAILED";
    return false;
  }
  if (report.runner_version !== options.expectedVersion) {
    report.execution_failure = "VERSION_MISMATCH";
    return false;
  }
  return true;
}

export async function runSchemaProbe(
  options: ProbeOptions,
): Promise<ProbeReport> {
  const report = initialReport(options);
  const started = performance.now();
  try {
    const executable = await realpath(options.executable);
    const pinned = { ...options, executable };
    report.executable_digest = await executableDigest(executable);
    if (!(await versionMatches(pinned, report))) return report;
    if ((await executableDigest(executable)) !== report.executable_digest) {
      report.execution_failure = "BINARY_CHANGED";
      return report;
    }
    report.attempts = 1;
    const invocationStarted = performance.now();
    const capture = await captureProcess({
      executable,
      args: probeArguments(options),
      cwd: options.cwd,
      timeoutMs: 60_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    report.timings_ms.invocation = Math.round(
      performance.now() - invocationStarted,
    );
    report.exit_code = capture.exitCode;
    report.execution_failure = capture.failure;
    report.diagnostic_codes = diagnostics(capture);
    report.result = validateProbe({ runner: options.runner, ...capture });
    return report;
  } catch {
    return { ...report, execution_failure: "INFRASTRUCTURE_FAILED" };
  } finally {
    report.timings_ms.total = Math.round(performance.now() - started);
  }
}
