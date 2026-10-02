import { failure, type Outcome } from "../../contracts/errors.js";
import type { SandboxResult } from "../../application/run-check.js";
import {
  runProcess,
  type ProcessRunOptions,
  type ProcessRunResult,
} from "../process/runner.js";
import {
  createContainerArgs,
  verifyContainer,
  type ContainerSpec,
  type ContainerInspection,
} from "./docker-profile.js";

export interface DockerOptions {
  executable: string;
  socketPath: string;
  configDir: string;
  cwd: string;
  signal?: AbortSignal;
}
export type ProcessPort = (
  options: ProcessRunOptions,
) => Promise<Outcome<ProcessRunResult>>;
export function dockerCommand(
  options: DockerOptions,
  process: ProcessPort = runProcess,
) {
  return (
    args: string[],
    limits: {
      timeoutMs?: number;
      maxOutputBytes?: number;
      signal?: AbortSignal;
    } = {},
  ) =>
    process({
      executable: options.executable,
      args: [
        "--host",
        `unix://${options.socketPath}`,
        "--config",
        options.configDir,
        ...args,
      ],
      cwd: options.cwd,
      env: { PATH: globalThis.process.env.PATH, LC_ALL: "C" },
      timeoutMs: limits.timeoutMs ?? 5_000,
      maxOutputBytes: limits.maxOutputBytes ?? 100_000,
      ...(limits.signal ? { signal: limits.signal } : {}),
    });
}
export type DockerCommand = ReturnType<typeof dockerCommand>;

async function inspectContainer(docker: DockerCommand, name: string) {
  const result = await docker(["inspect", "--format", "{{json .}}", name]);
  if (!result.ok || result.value.exitCode !== 0)
    return failure("CAPABILITY_MISSING", "Container state is unobservable.");
  try {
    return {
      ok: true as const,
      value: JSON.parse(result.value.stdout) as unknown,
    };
  } catch {
    return failure("CAPABILITY_MISSING", "Invalid container inspection.");
  }
}

export async function executeContainer(options: {
  docker: DockerCommand;
  spec: ContainerSpec;
  signal?: AbortSignal;
}): Promise<Outcome<SandboxResult>> {
  const { docker, spec } = options;
  if (options.signal?.aborted)
    return failure("CANCELLED", "Check cancelled before container creation.");
  let result: Outcome<SandboxResult>;
  try {
    const created = await docker(createContainerArgs(spec));
    if (!created.ok || created.value.exitCode !== 0)
      result = failure(
        "CAPABILITY_MISSING",
        "Container creation failed; cleanup will be reconciled.",
      );
    else result = await startAndCapture(options);
  } catch {
    result = failure("STORAGE_FAILED", "Container supervision failed.");
  }
  let cleaned: Outcome<void>;
  try {
    cleaned = await removeOwnedContainer(docker, spec.intent);
  } catch {
    cleaned = failure(
      "CAPABILITY_MISSING",
      "Container cleanup could not be confirmed.",
    );
  }
  if (!cleaned.ok) return cleaned;
  return result.ok
    ? { ok: true, value: { ...result.value, cleanupConfirmed: true } }
    : result;
}

async function startAndCapture(options: {
  docker: DockerCommand;
  spec: ContainerSpec;
  signal?: AbortSignal;
}): Promise<Outcome<SandboxResult>> {
  const { docker, spec } = options;
  const raw = await inspectContainer(docker, spec.intent.container_name);
  if (!raw.ok) return raw;
  const checked = verifyContainer(raw.value, spec);
  if (!checked.ok) return checked;
  if (options.signal?.aborted)
    return failure("CANCELLED", "Check cancelled before start.");
  const remainingMs =
    Math.min(
      spec.deadlineMs,
      Date.parse(spec.intent.started_at) + spec.intent.timeout_ms,
    ) - Date.now();
  if (remainingMs <= 0)
    return { ok: true, value: interruptedCapture("CANCELLED") };
  const capture = await docker(["start", "--attach", checked.value.Id], {
    timeoutMs: remainingMs,
    maxOutputBytes: spec.intent.max_output_bytes,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!capture.ok)
    return {
      ok: true,
      value: interruptedCapture(capture.error.code, options.signal),
    };
  const final = await inspectContainer(docker, checked.value.Id);
  if (!final.ok) return final;
  const observed = verifyContainer(final.value, spec);
  if (!observed.ok) return observed;
  return {
    ok: true,
    value: completedCapture(observed.value.State, capture.value),
  };
}

function completedCapture(
  state: ContainerInspection["State"],
  capture: ProcessRunResult,
): SandboxResult {
  if (
    state.Running ||
    state.Status !== "exited" ||
    state.Error ||
    state.OOMKilled ||
    state.ExitCode < 0 ||
    state.ExitCode > 255
  )
    return {
      status: "FAILED",
      exitCode: null,
      stdout: capture.stdout,
      stderr: capture.stderr,
      cleanupConfirmed: false,
    };
  return {
    status: [126, 127].includes(state.ExitCode) ? "FAILED" : "SUCCEEDED",
    exitCode: state.ExitCode,
    stdout: capture.stdout,
    stderr: capture.stderr,
    cleanupConfirmed: false,
  };
}

export async function removeOwnedContainer(
  docker: DockerCommand,
  intent: ContainerSpec["intent"],
): Promise<Outcome<void>> {
  const before = await docker([
    "inspect",
    "--format",
    '{{index .Config.Labels "quorum.execution"}}',
    intent.container_name,
  ]);
  if (!before.ok)
    return failure(
      "CAPABILITY_MISSING",
      "Cleanup cannot confirm container ownership.",
    );
  if (before.value.exitCode !== 0)
    return absent(before.value)
      ? { ok: true, value: undefined }
      : failure("CAPABILITY_MISSING", "Container absence is unconfirmed.");
  if (before.value.stdout.trim() !== intent.execution_id)
    return failure(
      "SCOPE_DENIED",
      "Container ownership label does not match; deletion refused.",
    );
  const removed = await docker([
    "rm",
    "--force",
    "--volumes",
    intent.container_name,
  ]);
  if (!removed.ok || removed.value.exitCode !== 0)
    return failure(
      "CAPABILITY_MISSING",
      "Failed to stop and remove the check container.",
    );
  const after = await docker(["inspect", intent.container_name]);
  return after.ok && absent(after.value)
    ? { ok: true, value: undefined }
    : failure("CAPABILITY_MISSING", "Container removal remains unconfirmed.");
}
function absent(result: ProcessRunResult): boolean {
  return (
    result.exitCode !== null &&
    result.exitCode !== 0 &&
    /^Error: No such (object|container):/im.test(result.stderr)
  );
}

function interruptedCapture(code: string, signal?: AbortSignal): SandboxResult {
  return {
    status:
      code === "CANCELLED"
        ? signal?.aborted
          ? "CANCELLED"
          : "TIMED_OUT"
        : "FAILED",
    exitCode: null,
    stdout: "",
    stderr: "Capture interrupted or exceeded its limit.",
    cleanupConfirmed: false,
  };
}
