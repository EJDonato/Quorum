import { randomUUID } from "node:crypto";
import { captureProcess } from "./process.js";
import { containerAbsent } from "./container-boundary.js";

export interface ContainerCancellationReport {
  schema_version: "1.0.0";
  kind: "container_cancellation_probe";
  image_id: string;
  docker_version: string | null;
  container_id: string;
  launched: boolean;
  stubborn_tree_started: boolean;
  cancelled: boolean;
  cleanup_confirmed: boolean;
  cgroup_containment_effective: boolean;
  failure: string | null;
}

async function docker(args: string[], cwd: string, timeoutMs: number) {
  return captureProcess({
    executable: "/usr/local/bin/docker",
    args,
    cwd,
    timeoutMs,
    maxOutputBytes: 65_536,
  });
}

const stubbornScript = `set -eu
(while true; do sleep 1; done) &
CHILD_PID=$!
echo "TREE_STARTED:$CHILD_PID"
while true; do sleep 1; done
`;

export async function probeContainerCancellation(options: {
  imageId: string;
  cwd: string;
}): Promise<ContainerCancellationReport> {
  const id = `quorum-cancel-${randomUUID().replaceAll("-", "")}`;
  const report: ContainerCancellationReport = {
    schema_version: "1.0.0",
    kind: "container_cancellation_probe",
    image_id: options.imageId,
    docker_version: null,
    container_id: id,
    launched: false,
    stubborn_tree_started: false,
    cancelled: false,
    cleanup_confirmed: false,
    cgroup_containment_effective: false,
    failure: null,
  };

  const ver = await docker(
    ["info", "--format", "{{.ServerVersion}}"],
    options.cwd,
    5000,
  );
  if (ver.exitCode !== 0) {
    report.failure = "DOCKER_UNAVAILABLE";
    return report;
  }
  report.docker_version = ver.stdout.trim();

  const runArgs = [
    "run",
    "-d",
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
    "--entrypoint",
    "/bin/bash",
    options.imageId,
    "-c",
    stubbornScript,
  ];

  const launch = await docker(runArgs, options.cwd, 10_000);
  if (launch.exitCode !== 0) {
    report.failure = "LAUNCH_FAILED";
    return report;
  }
  report.launched = true;

  return monitorAndCancel(id, options.cwd, report);
}

async function monitorAndCancel(
  id: string,
  cwd: string,
  report: ContainerCancellationReport,
): Promise<ContainerCancellationReport> {
  // Wait for container to start tree
  let treeActive = false;
  for (let i = 0; i < 20; i++) {
    const logs = await docker(["logs", id], cwd, 3000);
    if (logs.stdout.includes("TREE_STARTED:")) {
      treeActive = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!treeActive) {
    report.failure = "STUBBORN_TREE_FAILED";
    await docker(["rm", "--force", id], cwd, 5000);
    return report;
  }
  report.stubborn_tree_started = true;

  // Cancel by force-removing container
  const rmResult = await docker(["rm", "--force", id], cwd, 5000);
  report.cancelled = rmResult.exitCode === 0;

  // Verify container absence
  const inspect = await docker(["inspect", id], cwd, 5000);
  report.cleanup_confirmed = containerAbsent(inspect);
  report.cgroup_containment_effective =
    report.cancelled && report.cleanup_confirmed;

  if (!report.cgroup_containment_effective) {
    report.failure = "CANCELLATION_FAILED";
  }

  return report;
}
