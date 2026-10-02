import { join } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import type { ArtifactReference } from "../../contracts/ballot-input.js";
import type { CheckResult } from "../../contracts/checks.js";
import type { ValidationIntent } from "../../contracts/validation.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { ensurePrivateDirectory } from "../workspace/directories.js";
import { writeArtifact } from "../storage/artifacts.js";

export function validationStorage(artifactsDir: string) {
  return {
    persistIntent: (intent: ValidationIntent) =>
      persistIntent(artifactsDir, intent),
    persistStreams: (id: string, streams: { stdout: string; stderr: string }) =>
      persistStreams(artifactsDir, id, streams),
    persistResult: (record: CheckResult) => persistResult(artifactsDir, record),
  };
}

async function persistIntent(
  artifactsDir: string,
  intent: ValidationIntent,
): Promise<Outcome<void>> {
  try {
    await ensurePrivateDirectory(artifactsDir, `checks/${intent.execution_id}`);
  } catch {
    return failure("STORAGE_FAILED", "Cannot reserve check evidence storage.");
  }
  const write = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `checks/${intent.execution_id}/intent.json`,
    content: JSON.stringify(intent, null, 2) + "\n",
  });
  return write.ok ? { ok: true, value: undefined } : write;
}

async function persistStreams(
  artifactsDir: string,
  id: string,
  streams: { stdout: string; stderr: string },
) {
  const stdout = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `checks/${id}/stdout.txt`,
    content: streams.stdout,
  });
  if (!stdout.ok) return stdout;
  const stderr = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `checks/${id}/stderr.txt`,
    content: streams.stderr,
  });
  if (!stderr.ok) return stderr;
  return {
    ok: true as const,
    value: {
      stdout: { artifact_id: `${id}-stdout`, digest: stdout.value.digest },
      stderr: { artifact_id: `${id}-stderr`, digest: stderr.value.digest },
    },
  };
}

async function persistResult(
  artifactsDir: string,
  record: CheckResult,
): Promise<Outcome<ArtifactReference>> {
  const digest = canonicalDigest(record);
  if (!digest.ok) return digest;
  const ref = { artifact_id: record.check_result_id, digest: digest.value };
  const written = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `${ref.artifact_id}.json`,
    content: JSON.stringify(record, null, 2) + "\n",
  });
  if (!written.ok) return written;
  const completion = await writeArtifact({
    baseDir: join(artifactsDir, "checks", record.check_result_id),
    relativePath: "completion.json",
    content:
      JSON.stringify({
        schema_version: "1.0.0",
        execution_id: record.check_result_id,
        result_ref: ref,
        cleanup_confirmed: true,
      }) + "\n",
  });
  return completion.ok ? { ok: true, value: ref } : completion;
}
