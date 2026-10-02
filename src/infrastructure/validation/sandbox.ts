import { validationEnvironment } from "../../application/validation-input.js";
import { inspectImage } from "./docker-image.js";
import { mkdir, chmod, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { failure } from "../../contracts/errors.js";
import type { ValidationPorts } from "../../application/run-check.js";
import { inspectPath } from "../workspace/scoped-read.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { dockerCommand, executeContainer, type ProcessPort } from "./docker.js";
import { exportCheckSnapshot } from "./snapshot.js";

export interface SandboxOptions {
  repository: string;
  scratchRoot: string;
  dockerExecutable: string;
  socketPath: string;
  signal?: AbortSignal;
  process?: ProcessPort;
}
export function validationSandbox(
  options: SandboxOptions,
): ValidationPorts["execute"] {
  return async (request) => {
    if (
      !isAbsolute(options.scratchRoot) ||
      !isAbsolute(options.socketPath) ||
      !isAbsolute(options.dockerExecutable)
    )
      return failure(
        "INVALID_INPUT",
        "Validation requires explicit absolute host paths.",
      );
    const root = join(options.scratchRoot, request.intent.execution_id);
    try {
      await inspectPath(options.scratchRoot, ".");
      await mkdir(root, { mode: 0o700 });
    } catch {
      return failure(
        "STORAGE_FAILED",
        "Check scratch reservation failed; existing work was preserved.",
      );
    }
    const result = await runSandbox(options, request, root);
    // Unconfirmed container cleanup preserves mounts for explicit recovery.
    if (!result.ok) return result;
    try {
      await chmod(join(root, "snapshot"), 0o755);
      await rm(root, { recursive: true });
    } catch {
      return failure(
        "STORAGE_FAILED",
        "Check scratch cleanup failed; evidence is incomplete.",
      );
    }
    return result;
  };
}

async function runSandbox(
  options: SandboxOptions,
  request: Parameters<ValidationPorts["execute"]>[0],
  root: string,
) {
  const snapshot = join(root, "snapshot");
  try {
    const canonical = await prepareDirectories(root);
    const docker = connection(options, root);
    await writeFile(
      join(root, "owner.json"),
      JSON.stringify(request.intent) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    if (
      !Number.isFinite(request.deadlineMs) ||
      Date.now() >= request.deadlineMs
    )
      return failure(
        "BUDGET_EXHAUSTED",
        "Check deadline expired before setup.",
      );
    const image = await inspectImage(docker, request.intent.image);
    if (!image.ok) return image;
    const exported = await exportCheckSnapshot({
      repository: options.repository,
      tree: request.intent.tree,
      destination: snapshot,
      deadlineMs: request.deadlineMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!exported.ok) return exported;
    const environment = {
      ...image.value.environment,
      ...request.environment,
    };
    const bound = verifyDispatchBinding(request);
    if (!bound.ok) return bound;
    const envFile = await writeEnvironment(root, environment);
    return executeContainer({
      docker,
      spec: {
        intent: request.intent,
        command: request.command,
        snapshot: canonical,
        imageId: image.value.imageId,
        environment,
        envFile,
        deadlineMs: request.deadlineMs,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return failure(
      "STORAGE_FAILED",
      "Validation setup failed; no check approval was created.",
    );
  }
}

async function prepareDirectories(root: string) {
  await mkdir(join(root, "docker-config"), { mode: 0o700 });
  await mkdir(join(root, "snapshot"), { mode: 0o755 });
  await writeFile(
    join(root, "docker-config", "config.json"),
    '{"auths":{}}\n',
    { mode: 0o600, flag: "wx" },
  );
  const canonical = await realpath(join(root, "snapshot"));
  if (/[,\r\n]/.test(canonical)) throw new Error("Invalid mount path");
  return canonical;
}

function verifyDispatchBinding(
  request: Parameters<ValidationPorts["execute"]>[0],
) {
  const binding = canonicalDigest(request.command);
  const environmentDigest = canonicalDigest(
    validationEnvironment(
      { validation_image: request.intent.image },
      request.environment,
    ),
  );
  if (
    !binding.ok ||
    !environmentDigest.ok ||
    binding.value !== request.intent.command_digest ||
    environmentDigest.value !== request.intent.environment_digest
  )
    return failure(
      "STALE_INPUT",
      "Configured command changed before dispatch.",
    );
  return { ok: true as const, value: undefined };
}

function connection(options: SandboxOptions, root: string) {
  return dockerCommand(
    {
      executable: options.dockerExecutable,
      socketPath: options.socketPath,
      configDir: join(root, "docker-config"),
      cwd: root,
    },
    options.process,
  );
}

async function writeEnvironment(
  root: string,
  environment: Record<string, string>,
) {
  const path = join(root, "environment.env");
  const content =
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n";
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
  return path;
}
