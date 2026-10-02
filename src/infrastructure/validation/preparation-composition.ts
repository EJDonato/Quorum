import { failure, type Outcome } from "../../contracts/errors.js";
import { artifactReference } from "../../contracts/primitives.js";
import type { ArtifactReference } from "../../contracts/ballot-input.js";
import type { TestPreparationPorts } from "../../application/schedule-test-preparation.js";
import type { TestPreparationInput } from "../../application/test-preparation-input.js";
import { validatePreparationInput } from "../../application/test-preparation-input.js";
import { runConfiguredCheck } from "../../application/run-check.js";
import { readArtifact, writeArtifact } from "../storage/artifacts.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { validationStorage } from "./storage.js";
import { validationSandbox, type SandboxOptions } from "./sandbox.js";
import { verifyQaOverlay } from "./qa-overlay.js";

export function createTestPreparationPorts(options: {
  input: TestPreparationInput;
  invocationId: string;
  artifactsDir: string;
  sandbox: SandboxOptions;
  authorize: () => Promise<Outcome<{ remainingMs: number }>>;
}): TestPreparationPorts {
  return {
    digest: canonicalDigest,
    readArtifact: (ref) => readPreparationArtifact(options.artifactsDir, ref),
    verifyOverlay: async (overlay) => {
      const stored = await persistPreparationInputs(
        options.input,
        options.artifactsDir,
      );
      if (!stored.ok) return stored;
      return verifyQaOverlay({
        ...overlay,
        repository: options.sandbox.repository,
      });
    },
    runCheck: async (check) => {
      const result = await runConfiguredCheck({
        ...check,
        config: options.input.config,
        invocationId: options.invocationId,
        environment: { ...options.input.environment },
        ports: {
          ...validationStorage(options.artifactsDir),
          digest: canonicalDigest,
          authorize: options.authorize,
          execute: validationSandbox(options.sandbox),
          now: () => new Date(),
        },
      });
      return result.ok ? { ok: true, value: result.value.reference } : result;
    },
    persistReceipt: async (receipt) => {
      const digest = canonicalDigest(receipt);
      if (!digest.ok) return digest;
      const id = `test-preparation-${digest.value.slice(7)}`;
      const stored = await writeArtifact({
        baseDir: options.artifactsDir,
        relativePath: `${id}.json`,
        content: JSON.stringify(receipt, null, 2) + "\n",
      });
      return stored.ok
        ? { ok: true, value: { artifact_id: id, digest: digest.value } }
        : stored;
    },
  };
}

async function persistPreparationInputs(
  input: TestPreparationInput,
  artifactsDir: string,
): Promise<Outcome<void>> {
  const ready = validatePreparationInput(input, { digest: canonicalDigest });
  if (!ready.ok) return ready;
  const r = ready.value;
  for (const [label, record] of [
    ["config", r.config],
    ["motion", r.motion],
    ["specification", r.specification],
    ["snapshot", r.baseline],
    ["snapshot", r.expectedRed],
  ] as const) {
    const hashed = canonicalDigest(record);
    if (!hashed.ok) return hashed;
    const saved = await writeArtifact({
      baseDir: artifactsDir,
      relativePath: `preparation-${label}-${hashed.value.slice(7)}.json`,
      content: JSON.stringify(record, null, 2) + "\n",
    });
    if (!saved.ok) return saved;
  }
  return { ok: true, value: undefined };
}

export async function readPreparationArtifact(
  dir: string,
  ref: ArtifactReference,
): Promise<Outcome<unknown>> {
  if (!artifactReference.safeParse(ref).success)
    return failure("INVALID_INPUT", "Malformed preparation reference.");
  const read = await readArtifact({
    baseDir: dir,
    relativePath: `${ref.artifact_id}.json`,
  });
  if (!read.ok) return read;
  try {
    return {
      ok: true,
      value: JSON.parse(read.value.content.toString("utf8")) as unknown,
    };
  } catch {
    return failure("EVIDENCE_INVALID", "Malformed preparation evidence JSON.");
  }
}
