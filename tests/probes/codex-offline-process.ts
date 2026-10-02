import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  initialMessage,
  OfflineProtocol,
  type ProbeFailure,
} from "./codex-offline-protocol.js";

export function offlineEnvironment(root: string): NodeJS.ProcessEnv {
  // Deliberately do not spread process.env: proxies, provider keys and user config stay out.
  return {
    HOME: root,
    CODEX_HOME: root,
    TMPDIR: root,
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  };
}

// This bounds the experiment, not production descendant cancellation.
export function runOfflineProtocol(options: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  fakeProvider: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}) {
  const protocol = new OfflineProtocol({
    cwd: options.cwd,
    fakeProvider: options.fakeProvider,
  });
  return new Promise<{
    protocol: OfflineProtocol;
    failure: ProbeFailure | null;
    exitCode: number | null;
  }>((resolve) => {
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
    let failure: ProbeFailure | null = null;
    let stopping = false;
    let bytes = 0;
    let pending = "";
    const decoder = new StringDecoder("utf8");
    const stop = (reason: ProbeFailure | null) => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        ))
          failure = "LAUNCH_FAILED";
      }
    };
    const send = (message: unknown) => {
      child.stdin.write(JSON.stringify(message) + "\n");
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
        try {
          const value: unknown = JSON.parse(line);
          const next = protocol.receive(value);
          if (next.failure || next.done) stop(next.failure);
          else next.send.forEach(send);
        } catch {
          stop("INVALID_PROTOCOL");
        }
      }
    });
    child.stderr.on("data", account); // Never retain raw diagnostics or secret-bearing payloads.
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
        failure: stopping ? failure : "EARLY_EXIT",
        exitCode,
      });
    });
    child.once("spawn", () => send(initialMessage()));
  });
}
