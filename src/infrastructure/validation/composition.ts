import type { BrokerCheckPort } from "../../broker/broker.js";
import { candidateManifestSchema } from "../../contracts/candidate.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import { runConfiguredCheck } from "../../application/run-check.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { validationStorage } from "./storage.js";
import { validationSandbox, type SandboxOptions } from "./sandbox.js";

// Host composition only; none of these paths, grants, or effect ports are role inputs.
export function createValidationCheckPort(options: {
  config: unknown;
  candidate: unknown;
  sessionId: string;
  invocationId: string;
  checkIds: string[];
  artifactsDir: string;
  sandbox: SandboxOptions;
  environment: Record<string, string>;
  authorize: () => Promise<Outcome<{ remainingMs: number }>>;
}): Outcome<BrokerCheckPort> {
  const candidate = candidateManifestSchema.safeParse(options.candidate);
  if (
    !candidate.success ||
    candidate.data.identity.session_id !== options.sessionId
  )
    return failure(
      "EVIDENCE_INVALID",
      "Check candidate is malformed or belongs to another session.",
    );
  const grants = [...options.checkIds];
  return {
    ok: true,
    value: {
      sessionId: options.sessionId,
      invocationId: options.invocationId,
      inputDigest: candidate.data.candidate_id,
      grantedCheckIds: [...grants],
      run: async (checkId) => {
        if (!grants.includes(checkId))
          return failure("SCOPE_DENIED", "Check is not granted.");
        const result = await runConfiguredCheck({
          config: options.config,
          candidate: candidate.data,
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
      },
    },
  };
}
