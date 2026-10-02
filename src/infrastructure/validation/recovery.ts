import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import { validationIntentSchema } from "../../contracts/validation.js";
import { opaqueId } from "../../contracts/primitives.js";
import { readRecord } from "../storage/records.js";
import { writeArtifact } from "../storage/artifacts.js";
import { inspectPath } from "../workspace/scoped-read.js";
import { canonicalDigest } from "../artifacts/digests.js";
import {
  dockerCommand,
  removeOwnedContainer,
  type ProcessPort,
} from "./docker.js";
interface RecoveryOptions {
  artifactsDir: string;
  scratchRoot: string;
  executionId: string;
  dockerExecutable: string;
  socketPath: string;
  process?: ProcessPort;
}

// Host-only cleanup reconciliation. Interrupted checks always need a fresh invocation.
export async function reconcileInterruptedCheck(
  options: RecoveryOptions,
): Promise<Outcome<{ rerunRequired: true }>> {
  const ready = await readRecoveryState(options);
  if (!ready.ok) return ready;
  const { root, intent } = ready.value;
  try {
    await inspectPath(
      options.scratchRoot,
      `${options.executionId}/docker-config`,
    );
    const docker = dockerCommand(
      {
        executable: options.dockerExecutable,
        socketPath: options.socketPath,
        configDir: join(root, "docker-config"),
        cwd: root,
      },
      options.process,
    );
    const stopped = await removeOwnedContainer(docker, intent);
    if (!stopped.ok) return stopped;
    const result = await writeArtifact({
      baseDir: options.artifactsDir,
      relativePath: `checks/${options.executionId}/recovery.json`,
      content:
        JSON.stringify({
          schema_version: "1.0.0",
          execution_id: options.executionId,
          cleanup_confirmed: true,
          rerun_required: true,
        }) + "\n",
    });
    if (!result.ok) return result;
    await inspectPath(options.scratchRoot, `${options.executionId}/snapshot`);
    await chmod(join(root, "snapshot"), 0o755);
    await rm(root, { recursive: true });
    return { ok: true, value: { rerunRequired: true } };
  } catch {
    return failure(
      "SCOPE_DENIED",
      "Check recovery requires intact unlinked ownership paths.",
    );
  }
}

async function readRecoveryState(options: RecoveryOptions) {
  if (!opaqueId.safeParse(options.executionId).success)
    return failure("INVALID_INPUT", "Invalid check execution identity.");
  const stored = await readRecord({
    dir: join(options.artifactsDir, "checks", options.executionId),
    name: "intent.json",
    schema: validationIntentSchema,
  });
  if (!stored.ok) return stored;
  if (!stored.value || stored.value.execution_id !== options.executionId)
    return failure(
      "EVIDENCE_INVALID",
      "Check intent is missing or belongs to another operation.",
    );
  const root = join(options.scratchRoot, options.executionId);
  try {
    await inspectPath(options.scratchRoot, `${options.executionId}/owner.json`);
    const owner = await readRecord({
      dir: root,
      name: "owner.json",
      schema: validationIntentSchema,
    });
    if (!owner.ok) return owner;
    const ownerDigest = canonicalDigest(owner.value);
    const intentDigest = canonicalDigest(stored.value);
    if (
      !owner.value ||
      !ownerDigest.ok ||
      !intentDigest.ok ||
      ownerDigest.value !== intentDigest.value
    )
      return failure(
        "SCOPE_DENIED",
        "Scratch ownership differs from the recorded check.",
      );
    return { ok: true as const, value: { root, intent: stored.value } };
  } catch {
    return failure(
      "SCOPE_DENIED",
      "Check ownership paths are missing or linked.",
    );
  }
}
