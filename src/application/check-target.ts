import {
  verifyCandidateIdentity,
  type CanonicalHashPort,
} from "./candidates.js";
import { verifyPreparationSnapshot } from "./preparation-snapshots.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { CheckResult } from "../contracts/checks.js";
import type { PreparationSnapshot } from "../contracts/test-specification.js";

export type CheckTarget =
  | { candidate: unknown; snapshot?: never }
  | { snapshot: unknown; candidate?: never };
export interface PreparedCheckTarget {
  sessionId: string;
  tree: PreparationSnapshot["identity"]["tree"];
  input: CheckResult["input"];
  configurationDigest: string;
  environmentDigest: string;
}
export function prepareCheckTarget(
  target: CheckTarget,
  port: CanonicalHashPort,
): Outcome<PreparedCheckTarget> {
  if (target.candidate !== undefined && target.snapshot !== undefined)
    return failure("INVALID_INPUT", "A check requires one immutable target.");
  if (target.snapshot !== undefined) {
    const result = verifyPreparationSnapshot(target.snapshot, port);
    if (!result.ok) return result;
    const { identity, input_digest } = result.value;
    return {
      ok: true,
      value: {
        sessionId: identity.session_id,
        tree: identity.tree,
        input: { phase: identity.phase, input_digest },
        configurationDigest: identity.configuration_digest,
        environmentDigest: identity.environment_digest,
      },
    };
  }
  const result = verifyCandidateIdentity(target.candidate, port);
  if (!result.ok) return result;
  const { identity, candidate_id } = result.value;
  return {
    ok: true,
    value: {
      sessionId: identity.session_id,
      tree: identity.tree,
      input: { phase: "final", candidate_id },
      configurationDigest: identity.configuration_digest,
      environmentDigest: identity.validation_environment_digest,
    },
  };
}
