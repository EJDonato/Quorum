import { spawn } from "node:child_process";

export interface Capture {
  stdout: string;
  exitCode: number | null;
  interrupted: boolean;
  failure: "LAUNCH_FAILED" | "TIMED_OUT" | "OUTPUT_LIMIT" | "CANCELLED" | null;
}

// Test probe boundary only: process-group signals do not prove production cancellation.
export function captureProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}): Promise<Capture> {
  if (options.signal?.aborted)
    return Promise.resolve({
      stdout: "",
      exitCode: null,
      interrupted: true,
      failure: "CANCELLED",
    });
  return new Promise((resolve) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let failure: Capture["failure"] = null;
    const terminate = (reason: Capture["failure"]) => {
      failure ??= reason;
      try {
        if (child.pid !== undefined && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // A process may already have exited; close/error determines the receipt.
      }
      // Escaped descendants may retain pipes; they cannot extend the host deadline.
      child.stdout.destroy();
      child.stderr.destroy();
      finish(null);
    };
    const timer = setTimeout(() => terminate("TIMED_OUT"), options.timeoutMs);
    const cancel = () => terminate("CANCELLED");
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const collect = (chunk: Buffer, isStdout: boolean) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 1_048_576))
        terminate("OUTPUT_LIMIT");
      else if (isStdout) stdout.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        exitCode,
        interrupted: failure !== null,
        failure,
      });
    };
    child.once("error", () => {
      failure = "LAUNCH_FAILED";
      finish(null);
    });
    child.once("close", finish);
  });
}
