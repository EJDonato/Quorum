import {
  planTestPreparation,
  type TestPreparationPolicy,
  type TestPreparationPlan,
} from "../domain/test-preparation.js";
import { verifyPreparationSnapshot } from "./preparation-snapshots.js";
import { failure } from "../contracts/errors.js";
import type { EvidencePort } from "./evidence.js";
import { validationEnvironment } from "./validation-input.js";
export interface TestPreparationInput {
  config: unknown;
  motion: unknown;
  specification: unknown;
  baseline: unknown;
  expectedRed: unknown;
  policy: TestPreparationPolicy;
  environment: Record<string, string>;
}
export function validatePreparationInput(
  options: TestPreparationInput,
  port: Pick<EvidencePort, "digest">,
) {
  const plan = planTestPreparation(options);
  if (!plan.ok) return plan;
  const baseline = verifyPreparationSnapshot(options.baseline, port);
  const red = verifyPreparationSnapshot(options.expectedRed, port);
  if (!baseline.ok) return baseline;
  if (!red.ok) return red;
  if (
    (options.policy.changeKind === "behavior" ||
      options.policy.changeKind === "contract") &&
    red.value.identity.tree.oid === baseline.value.identity.tree.oid
  )
    return failure(
      "EVIDENCE_INVALID",
      "Expected-red validation requires newly authored tests.",
    );
  const hashes = preparationHashes(
    { ...plan.value, environment: options.environment },
    port,
  );
  if (!hashes.ok) return hashes;
  const h = hashes.value;
  for (const [snapshot, phase] of [
    [baseline.value, "baseline"],
    [red.value, "expected_red"],
  ] as const) {
    const i = snapshot.identity;
    if (
      i.phase !== phase ||
      i.session_id !== options.policy.sessionId ||
      i.baseline_tree.oid !== options.policy.baselineTree.oid ||
      i.baseline_tree.format !== options.policy.baselineTree.format ||
      i.configuration_digest !== h.configDigest ||
      i.motion_digest !== h.motionDigest ||
      plan.value.specification.motion_digest !== h.motionDigest ||
      i.specification_digest !== h.specDigest ||
      i.environment_digest !== h.envDigest
    )
      return failure(
        "STALE_INPUT",
        "Preparation snapshot differs from current host-approved inputs.",
      );
  }
  return {
    ok: true as const,
    value: {
      ...plan.value,
      baseline: baseline.value,
      expectedRed: red.value,
      motionDigest: h.motionDigest,
      specificationDigest: h.specDigest,
    },
  };
}

function preparationHashes(
  options: Pick<TestPreparationPlan, "config" | "motion" | "specification"> & {
    environment: Record<string, string>;
  },
  port: Pick<EvidencePort, "digest">,
) {
  const config = port.digest(options.config);
  const motion = port.digest(options.motion);
  const spec = port.digest(options.specification);
  const env = port.digest(
    validationEnvironment(options.config, options.environment),
  );
  if (!config.ok) return config;
  if (!motion.ok) return motion;
  if (!spec.ok) return spec;
  if (!env.ok) return env;
  return {
    ok: true as const,
    value: {
      configDigest: config.value,
      motionDigest: motion.value,
      specDigest: spec.value,
      envDigest: env.value,
    },
  };
}
