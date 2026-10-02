import type { BrokerCheckPort } from "../../broker/broker.js";
import { candidateManifestSchema } from "../../contracts/candidate.js";
import { preparationSnapshotSchema } from "../../contracts/test-specification.js";
import {
  prepareCheckTarget,
  type CheckTarget,
} from "../../application/check-target.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import { runConfiguredCheck } from "../../application/run-check.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { validationStorage } from "./storage.js";
import { validationSandbox, type SandboxOptions } from "./sandbox.js";

// Host composition only; none of these paths, grants, or effect ports are role inputs.
type ValidationCheckOptions = CheckTarget & {
  config: unknown;
  sessionId: string;
  invocationId: string;
  checkIds: string[];
  artifactsDir: string;
  sandbox: SandboxOptions;
  environment: Record<string, string>;
  authorize: () => Promise<Outcome<{ remainingMs: number }>>;
};
export function createValidationCheckPort(
  options: ValidationCheckOptions,
): Outcome<BrokerCheckPort> {
  const prepared = prepareCheckTarget(options, { digest: canonicalDigest });
  if (!prepared.ok) return prepared;
  if (prepared.value.sessionId !== options.sessionId)
    return failure(
      "EVIDENCE_INVALID",
      "Check input belongs to another session.",
    );
  const target: CheckTarget =
    options.snapshot !== undefined
      ? { snapshot: preparationSnapshotSchema.parse(options.snapshot) }
      : { candidate: candidateManifestSchema.parse(options.candidate) };
  const grants = [...options.checkIds];
  return {
    ok: true,
    value: {
      sessionId: options.sessionId,
      invocationId: options.invocationId,
      inputDigest:
        "candidate_id" in prepared.value.input
          ? prepared.value.input.candidate_id
          : prepared.value.input.input_digest,
      grantedCheckIds: [...grants],
      run: grantedCheckRunner(options, target, grants),
    },
  };
}

function grantedCheckRunner(
  options: ValidationCheckOptions,
  target: CheckTarget,
  grants: string[],
): BrokerCheckPort["run"] {
  return async (checkId: string) => {
    if (!grants.includes(checkId))
      return failure("SCOPE_DENIED", "Check is not granted.");
    const result = await runConfiguredCheck({
      config: options.config,
      ...target,
      checkId,
      invocationId: options.invocationId,
      environment: { ...options.environment },
      ports: {
        digest: canonicalDigest,
        authorize: options.authorize,
        ...validationStorage(options.artifactsDir),
        execute: validationSandbox(options.sandbox),
        now: () => new Date(),
      },
    });
    return result.ok
      ? {
          ok: true,
          value: {
            execution_id: result.value.execution_id,
            status: result.value.status,
            evidence_ref: result.value.evidence_ref,
          },
        }
      : result;
  };
}
