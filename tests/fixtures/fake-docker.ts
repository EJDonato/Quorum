import { readFile } from "node:fs/promises";
// Deterministic Docker metadata fixture; never evidence of real container isolation.
import { failure } from "../../src/contracts/errors.js";
import type { ProcessPort } from "../../src/infrastructure/validation/docker.js";
import type { ContainerInspection } from "../../src/infrastructure/validation/docker-profile.js";
import { completeReport, localImage } from "./validation.js";

export function fakeDocker(
  options: {
    stdout?: string;
    exitCode?: number;
    imageMissing?: boolean;
    createFailure?: boolean;
    interrupted?: "CANCELLED" | "STORAGE_FAILED";
    cleanupFailure?: boolean;
    wrongOwner?: boolean;
    alter?: (container: ContainerInspection) => void;
  } = {},
) {
  const calls: Parameters<ProcessPort>[0][] = [];
  const environments: string[][] = [];
  let present = false;
  let started = false;
  let container: ContainerInspection | null = null;
  const success = (stdout = "", exitCode = 0, stderr = "") => ({
    ok: true as const,
    value: { stdout, exitCode, stderr },
  });
  const process: ProcessPort = async (call) => {
    calls.push(call);
    const args = call.args.slice(4);
    if (args[0] === "info") return Promise.resolve(success("linux\n"));
    if (args[0] === "image")
      return Promise.resolve(
        options.imageMissing
          ? success("", 1)
          : success(
              JSON.stringify({
                Id: `sha256:${"d".repeat(64)}`,
                Os: "linux",
                RepoDigests: [localImage],
                Config: {
                  Volumes: null,
                  Env: ["PATH=/image", "HOST_SECRET_FORBIDDEN=BAKED_FIXTURE"],
                },
              }),
            ),
      );
    if (args[0] === "create") {
      if (options.createFailure) return Promise.resolve(success("", 1));
      const env = (
        await readFile(args[args.indexOf("--env-file") + 1] ?? "", "utf8")
      )
        .trim()
        .split("\n");
      environments.push(env);
      container = inspection(args, env);
      present = true;
      options.alter?.(container);
      return Promise.resolve(success(container.Id));
    }
    if (args[0] === "start") {
      started = true;
      if (options.interrupted)
        return Promise.resolve(
          failure(options.interrupted, "Injected interruption"),
        );
      return Promise.resolve(
        success(options.stdout ?? JSON.stringify(completeReport)),
      );
    }
    if (args[0] === "rm") {
      if (options.cleanupFailure) return Promise.resolve(success("", 1));
      present = false;
      return Promise.resolve(success("removed"));
    }
    if (args[0] === "inspect") {
      if (!present || !container)
        return Promise.resolve(
          success("", 1, "Error: No such object: fixture\n"),
        );
      if (args[2]?.includes("quorum.execution"))
        return Promise.resolve(
          success(
            options.wrongOwner
              ? "foreign-owner"
              : container.Config.Labels["quorum.execution"],
          ),
        );
      if (started)
        container.State = {
          Status: "exited",
          Running: false,
          ExitCode: options.exitCode ?? 0,
          OOMKilled: false,
          Error: "",
        };
      return Promise.resolve(success(JSON.stringify(container)));
    }
    return Promise.resolve(success("", 1, "Unsupported fake operation"));
  };
  return { process, calls, environments };
}

function inspection(args: string[], env: string[]): ContainerInspection {
  const value = (flag: string) => args[args.indexOf(flag) + 1] ?? "";
  const mount =
    value("--mount")
      .split(",")
      .find((part) => part.startsWith("src="))
      ?.slice(4) ?? "";
  const entry = args.indexOf("--entrypoint");
  const imageIndex = args.findIndex((arg) => /^sha256:[a-f0-9]{64}$/.test(arg));
  return {
    Id: "1".repeat(64),
    Image: args[imageIndex] ?? "",
    Config: {
      User: "65534:65534",
      WorkingDir: "/workspace",
      Labels: { "quorum.execution": value("--label").split("=")[1] ?? "" },
      Env: env,
      Entrypoint: [args[entry + 1] ?? ""],
      Cmd: args.slice(imageIndex + 1),
    },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: null,
      Init: true,
      UTSMode: "",
      SecurityOpt: ["no-new-privileges"],
      PidMode: "",
      IpcMode: "none",
      CgroupnsMode: "private",
      NanoCpus: 1_000_000_000,
      Memory: 536_870_912,
      MemorySwap: 536_870_912,
      PidsLimit: 64,
      Tmpfs: {
        "/tmp": "rw,nosuid,noexec,size=67108864,mode=1777",
        "/scratch": "rw,nosuid,noexec,size=67108864,mode=1777",
      },
      LogConfig: { Type: "none" },
    },
    Mounts: [
      { Type: "bind", Source: mount, Destination: "/workspace", RW: false },
    ],
    State: {
      Status: "created",
      Running: false,
      ExitCode: 0,
      OOMKilled: false,
      Error: "",
    },
  };
}
