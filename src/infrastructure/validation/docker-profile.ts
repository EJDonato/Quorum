import { z } from "zod";
import type { ValidationIntent } from "../../contracts/validation.js";
import type { RepositoryConfig } from "../../contracts/config.js";
import { failure, type Outcome } from "../../contracts/errors.js";

export const imageInspectionSchema = z.object({
  Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  Os: z.literal("linux"),
  RepoDigests: z.array(z.string()),
  Config: z.object({
    Env: z.array(z.string()).nullable(),
    Volumes: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});
export const containerInspectionSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
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
    UTSMode: z.string(),
    SecurityOpt: z.array(z.string()),
    PidMode: z.string(),
    IpcMode: z.string(),
    CgroupnsMode: z.string(),
    NanoCpus: z.number(),
    Memory: z.number(),
    MemorySwap: z.number(),
    PidsLimit: z.number(),
    Tmpfs: z.record(z.string(), z.string()),
    LogConfig: z.object({ Type: z.string() }),
  }),
  Mounts: z.array(
    z.object({
      Type: z.string(),
      Source: z.string(),
      Destination: z.string(),
      RW: z.boolean(),
    }),
  ),
  State: z.object({
    Status: z.string(),
    Running: z.boolean(),
    ExitCode: z.number().int(),
    OOMKilled: z.boolean(),
    Error: z.string(),
  }),
});
export type ContainerInspection = z.infer<typeof containerInspectionSchema>;
export interface ContainerSpec {
  intent: ValidationIntent;
  command: RepositoryConfig["commands"][number];
  snapshot: string;
  imageId: string;
  environment: Record<string, string>;
  envFile: string;
  deadlineMs: number;
}

export function createContainerArgs(spec: ContainerSpec): string[] {
  const args = [
    "create",
    "--pull=never",
    "--name",
    spec.intent.container_name,
    "--label",
    `quorum.execution=${spec.intent.execution_id}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--init",
    "--no-healthcheck",
    "--pids-limit=64",
    "--cpus=1",
    "--memory=512m",
    "--memory-swap=512m",
    "--user=65534:65534",
    "--ipc=none",
    "--cgroupns=private",
    "--log-driver=none",
    "--workdir=/workspace",
    "--tmpfs",
    "/tmp:rw,nosuid,noexec,size=67108864,mode=1777",
    "--tmpfs",
    "/scratch:rw,nosuid,noexec,size=67108864,mode=1777",
    "--mount",
    `type=bind,src=${spec.snapshot},dst=/workspace,readonly`,
    "--entrypoint",
    spec.command.executable,
  ];
  args.push("--env-file", spec.envFile);
  return [...args, spec.imageId, ...spec.command.args];
}

export function verifyContainer(
  value: unknown,
  spec: ContainerSpec,
): Outcome<ContainerInspection> {
  const parsed = containerInspectionSchema.safeParse(value);
  if (!parsed.success)
    return failure(
      "CAPABILITY_MISSING",
      "Cannot verify container isolation configuration.",
    );
  const c = parsed.data;
  const h = c.HostConfig;
  const expectedEnv = Object.entries(spec.environment)
    .map(([key, val]) => `${key}=${val}`)
    .sort();
  const bind = c.Mounts.filter((mount) => mount.Type !== "tmpfs");
  if (
    c.Image !== spec.imageId ||
    c.Config.Labels["quorum.execution"] !== spec.intent.execution_id ||
    c.Config.User !== "65534:65534" ||
    c.Config.WorkingDir !== "/workspace" ||
    JSON.stringify(c.Config.Entrypoint) !==
      JSON.stringify([spec.command.executable]) ||
    JSON.stringify(c.Config.Cmd ?? []) !== JSON.stringify(spec.command.args) ||
    JSON.stringify([...c.Config.Env].sort()) !== JSON.stringify(expectedEnv) ||
    h.NetworkMode !== "none" ||
    !h.ReadonlyRootfs ||
    h.Privileged ||
    JSON.stringify(h.CapDrop) !== JSON.stringify(["ALL"]) ||
    (h.CapAdd?.length ?? 0) !== 0 ||
    !h.Init ||
    h.UTSMode !== "" ||
    JSON.stringify(h.SecurityOpt) !== JSON.stringify(["no-new-privileges"]) ||
    h.PidMode !== "" ||
    h.IpcMode !== "none" ||
    h.CgroupnsMode !== "private" ||
    h.NanoCpus !== 1_000_000_000 ||
    h.Memory !== 536_870_912 ||
    h.MemorySwap !== h.Memory ||
    h.PidsLimit !== 64 ||
    h.LogConfig.Type !== "none" ||
    Object.keys(h.Tmpfs).sort().join(",") !== "/scratch,/tmp" ||
    Object.values(h.Tmpfs).some(
      (value) => value !== "rw,nosuid,noexec,size=67108864,mode=1777",
    ) ||
    bind.length !== 1 ||
    bind[0]?.Type !== "bind" ||
    bind[0]?.Source !== spec.snapshot ||
    bind[0]?.Destination !== "/workspace" ||
    bind[0]?.RW
  )
    return failure(
      "CAPABILITY_MISSING",
      "Container does not match the required validation boundary.",
    );
  return { ok: true, value: c };
}
