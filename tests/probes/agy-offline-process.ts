import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  AgyOfflineProtocol,
  type AgyProbeFailure,
} from "./agy-offline-protocol.js";

export function agyOfflineEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    TMPDIR: root,
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  };
}

export type RunAgyOfflineOptions = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  inputLines?: string[];
  initOnly?: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
};

export type RunAgyOfflineResult = {
  protocol: AgyOfflineProtocol;
  failure: AgyProbeFailure | null;
  exitCode: number | null;
};

export function runAgyOfflineProtocol(
  options: RunAgyOfflineOptions,
): Promise<RunAgyOfflineResult> {
  const protocol = new AgyOfflineProtocol({
    ...(options.initOnly ? { initOnly: true } : {}),
  });
  return new Promise<RunAgyOfflineResult>((resolve) => {
    if (options.signal?.aborted) {
      resolve({ protocol, failure: "CANCELLED", exitCode: null });
      return;
    }
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let failure: AgyProbeFailure | null = null;
    let stopping = false;
    let bytes = 0;
    let pending = "";
    const decoder = new StringDecoder("utf8");

    const stop = (reason: AgyProbeFailure | null) => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      try {
        if (child.pid && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        )) {
          failure = "LAUNCH_FAILED";
        }
      }
    };

    const account = (buffer: Buffer) => {
      bytes += buffer.length;
      if (bytes > options.maxOutputBytes) stop("OUTPUT_LIMIT");
    };

    child.stdout.on("data", (buffer: Buffer) => {
      account(buffer);
      if (stopping) return;
      pending += decoder.write(buffer);
      while (pending.includes("\n") && !stopping) {
        const boundary = pending.indexOf("\n");
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (line.trim().length === 0) continue;
        try {
          const value: unknown = JSON.parse(line);
          const next = protocol.receive(value);
          if (next.failure || next.done) stop(next.failure);
        } catch {
          stop("INVALID_PROTOCOL");
        }
      }
    });

    child.stderr.on("data", account);
    child.stdin.on("error", () => stop("EARLY_EXIT"));
    child.on("error", () => stop("LAUNCH_FAILED"));

    const cancel = () => stop("CANCELLED");
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => stop("TIMED_OUT"), options.timeoutMs);

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      resolve({
        protocol,
        failure: stopping ? failure : null,
        exitCode,
      });
    });

    child.once("spawn", () => {
      if (options.inputLines && options.inputLines.length > 0) {
        for (const line of options.inputLines) {
          child.stdin.write(line + "\n");
        }
      }
      child.stdin.end();
    });
  });
}
