import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { captureProcess, type Capture } from "./process.js";
import { containerAbsent } from "./container-boundary.js";
import type { AgyContainerImageReport } from "./agy-container-image-report.js";

const imageSchema = z.object({
  Id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Os: z.literal("linux"),
  Config: z.object({
    Env: z.array(z.string()).nullable(),
    Volumes: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

const containerSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/u),
  Image: z.string(),
  Config: z.object({
    User: z.string(),
    Labels: z.record(z.string(), z.string()),
    Env: z.array(z.string()),
    WorkingDir: z.string(),
    Entrypoint: z.array(z.string()),
    Cmd: z.array(z.string()).nullable(),
  }),
  HostConfig: z.object({
    NetworkMode: z.string(),
    ReadonlyRootfs: z.boolean(),
    Privileged: z.boolean(),
    CapDrop: z.array(z.string()),
    CapAdd: z.array(z.string()).nullable(),
    Init: z.boolean(),
    SecurityOpt: z.array(z.string()),
    IpcMode: z.string(),
    CgroupnsMode: z.string(),
    NanoCpus: z.number(),
    Memory: z.number(),
    MemorySwap: z.number(),
    PidsLimit: z.number(),
    Tmpfs: z.record(z.string(), z.string()),
    LogConfig: z.object({ Type: z.string() }),
  }),
  Mounts: z.array(z.object({ Type: z.string() })),
});

type DockerProcess = (args: string[], cwd: string) => Promise<Capture>;

export async function probeAgyContainerImage(options: {
  imageId: string;
  runnerPath: string;
  expectedVersion: string;
  cwd: string;
  process?: DockerProcess;
}): Promise<AgyContainerImageReport> {
  const run = options.process ?? docker;
  const report = initialReport(options);
  const version = await run(
    ["info", "--format", "{{.ServerVersion}}"],
    options.cwd,
  );
  if (version.exitCode !== 0 || version.failure)
    return failed(report, "DOCKER_UNAVAILABLE");
  report.docker_version = /^\d+\.\d+\.\d+$/u.test(version.stdout.trim())
    ? version.stdout.trim()
    : null;
  if (!report.docker_version) return failed(report, "DOCKER_UNAVAILABLE");
  const inspected = await run(
    ["image", "inspect", "--format", "{{json .}}", options.imageId],
    options.cwd,
  );
  if (inspected.exitCode !== 0 || inspected.failure)
    return failed(report, "IMAGE_MISSING");
  report.image_present = true;
  const image = parseJson(imageSchema, inspected.stdout);
  if (!image || image.Id !== options.imageId)
    return failed(report, "IMAGE_POLICY_FAILED");
  report.linux_image = true;
  report.no_declared_volumes = !Object.keys(image.Config.Volumes ?? {}).length;
  const environment = cleanEnvironment(image.Config.Env);
  if (!report.no_declared_volumes || !environment)
    return failed(report, "IMAGE_POLICY_FAILED");
  return runContainer({ options, report, environment, run });
}

async function runContainer(input: {
  options: Parameters<typeof probeAgyContainerImage>[0];
  report: AgyContainerImageReport;
  environment: Record<string, string>;
  run: DockerProcess;
}): Promise<AgyContainerImageReport> {
  const { options, report, environment, run } = input;
  const id = `quorum-agy-image-${randomUUID().replaceAll("-", "")}`;
  const created = await run(createArgs(options, environment, id), options.cwd);
  if (created.exitCode !== 0 || created.failure) {
    report.cleanup_confirmed = await cleanup(run, options.cwd, id);
    if (!report.cleanup_confirmed) return failed(report, "CLEANUP_FAILED");
    return failed(report, "CREATE_FAILED");
  }
  report.container_created = true;
  report.cleanup_confirmed = false;
  try {
    const inspected = await run(
      ["inspect", "--format", "{{json .}}", id],
      options.cwd,
    );
    const container = parseJson(containerSchema, inspected.stdout);
    if (
      inspected.exitCode !== 0 ||
      !container ||
      !verifyContainer({ container, options, environment, id })
    )
      return failed(report, "CONTAINER_POLICY_FAILED");
    report.container_configuration_verified = true;
    const copied = await copyAndDigest(run, options, id);
    if (!copied) return failed(report, "BINARY_COPY_FAILED");
    report.executable_digest = copied;
    const started = await run(["start", "--attach", id], options.cwd);
    if (started.exitCode !== 0 || started.failure)
      return failed(report, "VERSION_FAILED");
    report.observed_version = /^\d+\.\d+\.\d+$/u.test(started.stdout.trim())
      ? started.stdout.trim()
      : null;
    report.version_command_passed = report.observed_version !== null;
    if (report.observed_version !== options.expectedVersion)
      return failed(report, "VERSION_MISMATCH");
    return report;
  } finally {
    report.cleanup_confirmed = await cleanup(run, options.cwd, id);
    if (!report.cleanup_confirmed) report.failure = "CLEANUP_FAILED";
  }
}

function createArgs(
  options: Parameters<typeof probeAgyContainerImage>[0],
  environment: Record<string, string>,
  id: string,
): string[] {
  const args = [
    "create",
    "--pull=never",
    "--name",
    id,
    "--label",
    `quorum.fixture=${id}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--init",
    "--no-healthcheck",
    "--pids-limit=32",
    "--cpus=1",
    "--memory=256m",
    "--memory-swap=256m",
    "--user=65534:65534",
    "--ipc=none",
    "--cgroupns=private",
    "--log-driver=none",
    "--workdir=/workspace",
    "--tmpfs",
    "/tmp:rw,nosuid,noexec,size=67108864,mode=1777",
    "--tmpfs",
    "/home/quorum:rw,nosuid,noexec,size=67108864,mode=700",
    "--tmpfs",
    "/workspace:rw,nosuid,noexec,size=67108864,mode=700",
  ];
  for (const [key, value] of Object.entries(environment).sort())
    args.push("--env", `${key}=${value}`);
  return [
    ...args,
    "--entrypoint",
    options.runnerPath,
    options.imageId,
    "--version",
  ];
}

function verifyContainer(input: {
  container: z.infer<typeof containerSchema>;
  options: Parameters<typeof probeAgyContainerImage>[0];
  environment: Record<string, string>;
  id: string;
}): boolean {
  const { container: value, options, environment, id } = input;
  const h = value.HostConfig;
  const expectedEnv = Object.entries(environment)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return (
    value.Image === options.imageId &&
    value.Config.User === "65534:65534" &&
    value.Config.Labels["quorum.fixture"] === id &&
    value.Config.WorkingDir === "/workspace" &&
    JSON.stringify(value.Config.Entrypoint) ===
      JSON.stringify([options.runnerPath]) &&
    JSON.stringify(value.Config.Cmd ?? []) === JSON.stringify(["--version"]) &&
    JSON.stringify([...value.Config.Env].sort()) ===
      JSON.stringify(expectedEnv) &&
    h.NetworkMode === "none" &&
    h.ReadonlyRootfs &&
    !h.Privileged &&
    JSON.stringify(h.CapDrop) === JSON.stringify(["ALL"]) &&
    !h.CapAdd?.length &&
    h.Init &&
    JSON.stringify(h.SecurityOpt) === JSON.stringify(["no-new-privileges"]) &&
    h.IpcMode === "none" &&
    h.CgroupnsMode === "private" &&
    h.NanoCpus === 1_000_000_000 &&
    h.Memory === 268_435_456 &&
    h.MemorySwap === h.Memory &&
    h.PidsLimit === 32 &&
    h.LogConfig.Type === "none" &&
    Object.keys(h.Tmpfs).sort().join(",") === "/home/quorum,/tmp,/workspace" &&
    !value.Mounts.some((mount) => mount.Type !== "tmpfs")
  );
}

function cleanEnvironment(raw: string[] | null): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const item of raw ?? []) {
    const key = item.split("=", 1)[0];
    if (!key || !/^[A-Z_][A-Z0-9_]*$/u.test(key) || key in result) return null;
    result[key] = "";
  }
  return {
    ...result,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/quorum",
    TMPDIR: "/tmp",
  };
}

async function copyAndDigest(
  run: DockerProcess,
  options: Parameters<typeof probeAgyContainerImage>[0],
  id: string,
): Promise<string | null> {
  const path = join(options.cwd, "runner-copy.tmp");
  try {
    const copied = await run(
      ["cp", `${id}:${options.runnerPath}`, path],
      options.cwd,
    );
    if (copied.exitCode !== 0 || copied.failure) return null;
    return `sha256:${createHash("sha256")
      .update(await readFile(path))
      .digest("hex")}`;
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

async function cleanup(
  run: DockerProcess,
  cwd: string,
  id: string,
): Promise<boolean> {
  const owner = await run(
    ["inspect", "--format", '{{index .Config.Labels "quorum.fixture"}}', id],
    cwd,
  );
  if (owner.exitCode !== 0) return containerAbsent(owner);
  if (owner.stdout.trim() !== id) return false;
  const removed = await run(["rm", "--force", "--volumes", id], cwd);
  if (removed.exitCode !== 0 || removed.failure) return false;
  return containerAbsent(await run(["inspect", id], cwd));
}

function initialReport(
  options: Parameters<typeof probeAgyContainerImage>[0],
): AgyContainerImageReport {
  return {
    schema_version: "1.0.0",
    kind: "agy_container_image_probe",
    image_id: options.imageId,
    runner_path: options.runnerPath,
    expected_version: options.expectedVersion,
    observed_version: null,
    docker_version: null,
    image_present: false,
    linux_image: false,
    no_declared_volumes: false,
    container_created: false,
    container_configuration_verified: false,
    executable_digest: null,
    version_command_passed: false,
    cleanup_confirmed: true,
    failure: null,
    final_container_conformance: false,
    mandatory_capabilities: "PARTIAL",
  };
}

function failed(
  report: AgyContainerImageReport,
  failure: NonNullable<AgyContainerImageReport["failure"]>,
) {
  report.failure = failure;
  return report;
}

function parseJson<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function docker(args: string[], cwd: string) {
  return captureProcess({
    executable: "/usr/local/bin/docker",
    args,
    cwd,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C" },
    timeoutMs: 10_000,
    maxOutputBytes: 65_536,
  });
}
