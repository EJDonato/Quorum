import assert from "node:assert/strict";
import { createPreparationSnapshot } from "../../src/application/preparation-snapshots.js";
import type { TestPreparationInput } from "../../src/application/test-preparation-input.js";
import type { RepositoryConfig } from "../../src/contracts/config.js";
import type {
  PreparationSnapshot,
  TestSpecification,
} from "../../src/contracts/test-specification.js";
import { createFakePlan } from "../../src/domain/fake-roles.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { validationEnvironment } from "../../src/application/validation-input.js";
import { hash } from "./validation.js";

export function preparationInput(options: {
  config: RepositoryConfig;
  sessionId: string;
  baselineTree: PreparationSnapshot["identity"]["tree"];
  redTree: PreparationSnapshot["identity"]["tree"];
  changeKind?: TestPreparationInput["policy"]["changeKind"];
}): TestPreparationInput & {
  baseline: PreparationSnapshot;
  expectedRed: PreparationSnapshot;
} {
  options = {
    ...options,
    config: {
      ...options.config,
      paths: { ...options.config.paths, implementation: ["app.ts"] },
    },
  };
  const changeKind = options.changeKind ?? "behavior";
  const motion = createFakePlan(options.sessionId);
  motion.tasks[0]?.authorized_paths.splice(0, 2, "app.ts");
  if (changeKind === "refactor" || changeKind === "documentation")
    motion.risk = changeKind;
  const criterionId = motion.acceptance_criteria[0]?.criterion_id;
  assert.ok(criterionId);
  const expectation =
    changeKind === "contract"
      ? "compiler"
      : changeKind === "documentation"
        ? "documentation"
        : changeKind === "refactor"
          ? "regression"
          : "behavioral";
  const specification: TestSpecification = {
    schema_version: "1.0.0",
    motion_digest: hash(motion),
    mappings: [
      {
        criterion_id: criterionId,
        check_id: "unit",
        ...(expectation === "compiler"
          ? { expectation, expected_failure_id: "TS2322" }
          : expectation === "behavioral"
            ? { expectation, expected_failure_id: "value-contract" }
            : {
                expectation,
                justification:
                  "FAKE host-approved passing regression/documentation exception",
              }),
      },
    ],
  };
  const identity = {
    schema_version: "1.0.0",
    session_id: options.sessionId,
    baseline_tree: options.baselineTree,
    configuration_digest: hash(options.config),
    environment_digest: hash(validationEnvironment(options.config, {})),
    motion_digest: hash(motion),
    specification_digest: hash(specification),
  };
  const baseline = createPreparationSnapshot(
    { ...identity, phase: "baseline", tree: options.baselineTree },
    { digest: canonicalDigest },
  );
  const red = createPreparationSnapshot(
    { ...identity, phase: "expected_red", tree: options.redTree },
    { digest: canonicalDigest },
  );
  assert.ok(baseline.ok && red.ok);
  return {
    config: options.config,
    motion,
    specification,
    baseline: baseline.value,
    expectedRed: red.value,
    environment: {},
    policy: {
      sessionId: options.sessionId,
      changeKind,
      baselineTree: options.baselineTree,
      implementationPaths: ["app.ts"],
      protectedPaths: ["tests", ".quorum"],
      testPaths: ["tests"],
    },
  };
}
