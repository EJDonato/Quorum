import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureProcess } from "./process.js";

const script = `set -eu
[ "$(cat /probe/fixture.txt)" = QUORUM_FIXTURE ] && echo READ_OK
if (printf denied > /probe/fixture.txt) 2>/dev/null; then echo WRITE_BYPASS; else echo WRITE_DENIED; fi
if [ -e /host-source/canary ]; then echo SOURCE_EXPOSED; else echo SOURCE_ABSENT; fi
if [ -e /host-artifacts/canary ]; then echo ARTIFACTS_EXPOSED; else echo ARTIFACTS_ABSENT; fi
if [ -S /var/run/docker.sock ]; then echo SOCKET_EXPOSED; else echo SOCKET_ABSENT; fi
if [ -n "\${HOST_SECRET_FORBIDDEN-}" ]; then echo HOST_ENV_EXPOSED; else echo HOST_ENV_ABSENT; fi
if (printf scratch > /scratch/probe) 2>/dev/null; then echo SCRATCH_OK; else echo SCRATCH_FAILED; fi
if timeout 2 bash -c 'echo probe > /dev/tcp/1.1.1.1/443' >/dev/null 2>&1; then echo NETWORK_EXPOSED; else echo NETWORK_DENIED; fi`;

const expected = [
  "READ_OK",
  "WRITE_DENIED",
  "SOURCE_ABSENT",
  "ARTIFACTS_ABSENT",
  "SOCKET_ABSENT",
  "HOST_ENV_ABSENT",
  "SCRATCH_OK",
  "NETWORK_DENIED",
];

export interface ContainerProbeReport {
  schema_version: "1.0.0";
  kind: "synthetic_container_boundary";
  image_id: string;
  docker_version: string | null;
  container_id: string;
  launched: boolean;
  exit_code: number | null;
  failure: string | null;
  observations: Record<string, boolean | null>;
  cleanup_confirmed: boolean;
  runner_isolation_proven: false;
}

async function docker(args: string[], cwd: string, timeoutMs: number) {
  return captureProcess({
    executable: "/usr/local/bin/docker",
    args,
    cwd,
    timeoutMs,
    maxOutputBytes: 65_536,
    env: { ...process.env, HOST_SECRET_FORBIDDEN: "QUORUM_FIXTURE_MARKER" },
  });
}

async function confirmCleanup(id: string, cwd: string): Promise<boolean> {
  const inspect = await docker(
    ["inspect", "--format", '{{index .Config.Labels "quorum.fixture"}}', id],
    cwd,
    5_000,
  );
  if (inspect.exitCode !== 0) return containerAbsent(inspect);
  if (inspect.stdout.trim() !== id) return false;
  const removed = await docker(["rm", "--force", id], cwd, 5_000);
  if (removed.exitCode !== 0) return false;
  const after = await docker(["inspect", id], cwd, 5_000);
  return containerAbsent(after);
}

export function containerAbsent(capture: {
  exitCode: number | null;
  failure: string | null;
  stderr: string;
}): boolean {
  return (
    capture.exitCode !== null &&
    capture.exitCode !== 0 &&
    capture.failure === null &&
    /(?:^|\n)error: no such object:/i.test(capture.stderr)
  );
}

export async function probeContainerBoundary(options: {
  baseDirectory: string;
  imageId: string;
}): Promise<ContainerProbeReport> {
  const cwd = await mkdtemp(
    join(options.baseDirectory, "quorum-container-fixture-"),
  );
  await chmod(cwd, 0o755);
  await writeFile(join(cwd, "fixture.txt"), "QUORUM_FIXTURE", {
    mode: 0o644,
    flag: "wx",
  });
  const id = `quorum-m0-${randomUUID().replaceAll("-", "")}`;
  const report: ContainerProbeReport = {
    schema_version: "1.0.0",
    kind: "synthetic_container_boundary",
    image_id: options.imageId,
    docker_version: null,
    container_id: id,
    launched: false,
    exit_code: null,
    failure: null,
    observations: Object.fromEntries(expected.map((key) => [key, null])),
    cleanup_confirmed: false,
    runner_isolation_proven: false,
  };
  const version = await docker(
    ["info", "--format", "{{.ServerVersion}}"],
    cwd,
    5_000,
  );
  if (version.exitCode !== 0) {
    report.failure = "DOCKER_UNAVAILABLE";
    return report;
  }
  report.docker_version = /^\d+\.\d+\.\d+$/.test(version.stdout.trim())
    ? version.stdout.trim()
    : null;
  if (report.docker_version === null) {
    report.failure = "INVALID_DOCKER_VERSION";
    return report;
  }
  const args = [
    "run",
    "--rm",
    "--pull",
    "never",
    "--name",
    id,
    "--label",
    `quorum.fixture=${id}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "32",
    "--memory",
    "128m",
    "--user",
    "65534:65534",
    "--tmpfs",
    "/scratch:rw,nosuid,noexec,size=1048576,mode=1777",
    "--mount",
    `type=bind,src=${cwd},dst=/probe,readonly`,
    "--entrypoint",
    "/bin/bash",
    options.imageId,
    "-euc",
    script,
  ];
  try {
    const capture = await docker(args, cwd, 10_000);
    report.launched = capture.exitCode !== null;
    report.exit_code = capture.exitCode;
    report.failure =
      capture.failure ?? (capture.exitCode === 0 ? null : "CONTAINER_FAILED");
    const lines = capture.stdout.trim().split("\n");
    for (const key of expected) report.observations[key] = lines.includes(key);
    if (
      lines.length !== expected.length ||
      lines.some((line) => !expected.includes(line))
    )
      report.failure = "UNEXPECTED_OUTPUT";
  } finally {
    report.cleanup_confirmed = await confirmCleanup(id, cwd);
  }
  return report;
}
