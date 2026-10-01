import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureProcess } from "./process.js";

export interface ProcessGroupProbeResult {
  parentPid: number;
  childPid: number;
  parentTerminated: boolean;
  childTerminated: boolean;
  allTerminated: boolean;
}

export interface DetachedEscapeProbeResult {
  parentPid: number;
  detachedPid: number;
  parentTerminated: boolean;
  detachedSurvivedProcessGroup: boolean;
  cleanupSuccessful: boolean;
}

export interface CancellationReport {
  schema_version: "1.0.0";
  kind: "descendant_cancellation_probe";
  recorded_at: string;
  process_group_cleanup_effective: boolean;
  detached_escape_observed: boolean;
  container_boundary_required: true;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForPid(path: string, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const text = await readFile(path, "utf8");
      const pid = parseInt(text.trim(), 10);
      if (!Number.isNaN(pid) && pid > 0 && isProcessAlive(pid)) {
        return pid;
      }
    } catch {
      // Retry until file is written or timeout occurs.
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timeout waiting for PID file: ${path}`);
}

export async function probeProcessGroupCancellation(options?: {
  baseDir?: string;
}): Promise<ProcessGroupProbeResult> {
  const cwd = await mkdtemp(
    join(options?.baseDir ?? tmpdir(), "quorum-cancel-pg-"),
  );
  const parentPidPath = join(cwd, "parent.pid");
  const childPidPath = join(cwd, "child.pid");
  const scriptPath = join(cwd, "runner.sh");

  const script = `#!/bin/sh
echo $$ > "${parentPidPath}"
(sleep 30) &
echo $! > "${childPidPath}"
wait
`;
  await writeFile(scriptPath, script, { mode: 0o700 });

  const controller = new AbortController();
  const capturePromise = captureProcess({
    executable: "/bin/sh",
    args: [scriptPath],
    cwd,
    timeoutMs: 10_000,
    signal: controller.signal,
  });

  const parentPid = await waitForPid(parentPidPath, 3_000);
  const childPid = await waitForPid(childPidPath, 3_000);

  controller.abort();
  await capturePromise;
  await new Promise((r) => setTimeout(r, 100));

  const parentAlive = isProcessAlive(parentPid);
  const childAlive = isProcessAlive(childPid);

  return {
    parentPid,
    childPid,
    parentTerminated: !parentAlive,
    childTerminated: !childAlive,
    allTerminated: !parentAlive && !childAlive,
  };
}

export async function probeDetachedDescendantEscape(options?: {
  baseDir?: string;
}): Promise<DetachedEscapeProbeResult> {
  const cwd = await mkdtemp(
    join(options?.baseDir ?? tmpdir(), "quorum-cancel-detached-"),
  );
  const parentPidPath = join(cwd, "parent.pid");
  const detachedPidPath = join(cwd, "detached.pid");
  const scriptPath = join(cwd, "runner.js");

  const script = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));
const detached = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
  detached: true,
  stdio: "ignore",
});
writeFileSync(${JSON.stringify(detachedPidPath)}, String(detached.pid));
detached.unref();
setInterval(() => {}, 1000);
`;
  await writeFile(scriptPath, script, { mode: 0o600 });

  const controller = new AbortController();
  const capturePromise = captureProcess({
    executable: process.execPath,
    args: [scriptPath],
    cwd,
    timeoutMs: 10_000,
    signal: controller.signal,
  });

  const parentPid = await waitForPid(parentPidPath, 3_000);
  const detachedPid = await waitForPid(detachedPidPath, 3_000);

  controller.abort();
  await capturePromise;
  await new Promise((r) => setTimeout(r, 100));

  const parentAlive = isProcessAlive(parentPid);
  const detachedAlive = isProcessAlive(detachedPid);

  // Clean up the escaped process explicitly so nothing lingers.
  if (detachedAlive) {
    try {
      process.kill(detachedPid, "SIGKILL");
    } catch {
      // Process might have exited concurrently.
    }
  }

  await new Promise((r) => setTimeout(r, 50));
  const cleanupConfirmed = !isProcessAlive(detachedPid);

  return {
    parentPid,
    detachedPid,
    parentTerminated: !parentAlive,
    detachedSurvivedProcessGroup: detachedAlive,
    cleanupSuccessful: cleanupConfirmed,
  };
}

export async function runCancellationProbeSuite(options?: {
  baseDir?: string;
}): Promise<CancellationReport> {
  const pgResult = await probeProcessGroupCancellation(options);
  const detachedResult = await probeDetachedDescendantEscape(options);

  return {
    schema_version: "1.0.0",
    kind: "descendant_cancellation_probe",
    recorded_at: new Date().toISOString(),
    process_group_cleanup_effective: pgResult.allTerminated,
    detached_escape_observed: detachedResult.detachedSurvivedProcessGroup,
    container_boundary_required: true,
  };
}
