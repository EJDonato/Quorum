import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { failure, type Outcome } from "../../contracts/errors.js";

export interface ProcessRunOptions {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function terminateProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGKILL");
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Process may have already exited.
  }
}

interface AttachStreamsOptions {
  child: ChildProcess;
  maxBytes: number;
  onOverflow: () => void;
  processOptions: ProcessRunOptions;
}

function attachStreams(options: AttachStreamsOptions): {
  stdout: Buffer[];
  stderr: Buffer[];
  flush: () => void;
} {
  const { child, maxBytes, onOverflow, processOptions } = options;
  let total = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stdoutLines = createLineEmitter(processOptions.onStdoutLine);
  const stderrLines = createLineEmitter(processOptions.onStderrLine);
  const collect = (
    chunk: Buffer,
    target: Buffer[],
    lines: ReturnType<typeof createLineEmitter>,
  ) => {
    total += chunk.length;
    if (total > maxBytes) {
      onOverflow();
      return;
    }
    target.push(chunk);
    lines.push(chunk);
  };
  child.stdout?.on("data", (c: Buffer) => collect(c, stdout, stdoutLines));
  child.stderr?.on("data", (c: Buffer) => collect(c, stderr, stderrLines));
  return {
    stdout,
    stderr,
    flush: () => {
      stdoutLines.flush();
      stderrLines.flush();
    },
  };
}

function createLineEmitter(callback?: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const emit = (line: string) => {
    if (!callback) return;
    try {
      callback(line);
    } catch {
      // Progress presentation cannot change process execution.
    }
  };
  return {
    push(chunk: Buffer) {
      pending += decoder.write(chunk);
      let boundary = pending.indexOf("\n");
      while (boundary >= 0) {
        emit(pending.slice(0, boundary).replace(/\r$/u, ""));
        pending = pending.slice(boundary + 1);
        boundary = pending.indexOf("\n");
      }
    },
    flush() {
      pending += decoder.end();
      if (pending) emit(pending.replace(/\r$/u, ""));
      pending = "";
    },
  };
}

function completedProcessResult(
  streams: ReturnType<typeof attachStreams>,
  exitCode: number | null,
): Outcome<ProcessRunResult> {
  streams.flush();
  return {
    ok: true,
    value: {
      stdout: Buffer.concat(streams.stdout).toString("utf8"),
      stderr: Buffer.concat(streams.stderr).toString("utf8"),
      exitCode,
    },
  };
}

export async function runProcess(
  options: ProcessRunOptions,
): Promise<Outcome<ProcessRunResult>> {
  if (options.signal?.aborted) {
    return failure("CANCELLED", "Process execution was aborted before launch.");
  }

  let child: ChildProcess;
  try {
    child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
    });
  } catch {
    return failure("STORAGE_FAILED", `Failed to spawn ${options.executable}.`);
  }

  return monitorProcess(child, options);
}

function monitorProcess(
  child: ChildProcess,
  options: ProcessRunOptions,
): Promise<Outcome<ProcessRunResult>> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (result: Outcome<ProcessRunResult>) => {
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      terminateProcessGroup(child.pid);
      finish(failure("CANCELLED", "Process execution cancelled by signal."));
    };

    const streams = attachStreams({
      child,
      maxBytes,
      onOverflow: () => {
        terminateProcessGroup(child.pid);
        finish(
          failure(
            "STORAGE_FAILED",
            "Process output exceeded maximum byte limit.",
          ),
        );
      },
      processOptions: options,
    });

    options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      terminateProcessGroup(child.pid);
      finish(failure("CANCELLED", "Process execution timed out."));
    }, timeoutMs);

    child.on("error", () => {
      finish(
        failure("STORAGE_FAILED", `Error executing ${options.executable}.`),
      );
    });

    child.on("close", (code) => finish(completedProcessResult(streams, code)));
  });
}
