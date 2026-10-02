import {
  repositoryConfigSchema,
  type RepositoryConfig,
} from "../contracts/config.js";
import {
  testSpecificationSchema,
  testPreparationPolicySchema,
  type TestPreparationPolicy,
  type TestSpecification,
} from "../contracts/test-specification.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { gitObject, repositoryPath } from "../contracts/primitives.js";
import type { Motion } from "../contracts/motion.js";
import { validateMotion, pathWithin } from "./plans.js";

export type { TestPreparationPolicy };
export interface TestPreparationPlan {
  config: RepositoryConfig;
  specification: TestSpecification;
  motion: Motion;
  checks: { phase: "baseline" | "expected_red"; checkId: string }[];
}

export function planTestPreparation(options: {
  config: unknown;
  motion: unknown;
  specification: unknown;
  policy: TestPreparationPolicy;
}): Outcome<TestPreparationPlan> {
  const parsedPolicy = testPreparationPolicySchema.safeParse(options.policy);
  if (!parsedPolicy.success)
    return failure("INVALID_INPUT", "Malformed host preparation policy.");
  const policy = parsedPolicy.data;
  const config = repositoryConfigSchema.safeParse(options.config);
  const spec = testSpecificationSchema.safeParse(options.specification);
  const motion = validateMotion(options.motion, {
    sessionId: policy.sessionId,
    permittedPaths: policy.implementationPaths,
    protectedPaths: [
      ...policy.protectedPaths,
      ...(config.success
        ? [...config.data.paths.protected, ...config.data.paths.tests]
        : []),
    ],
  });
  if (!config.success || !spec.success || !motion.ok)
    return failure(
      "INVALID_INPUT",
      "Invalid test specification, configuration, or motion.",
    );
  const validPolicy = validatePreparationPolicy(
    policy,
    config.data,
    motion.value.motion,
  );
  if (!validPolicy.ok) return validPolicy;
  const mapped = validateMappings({
    specification: spec.data,
    motion: motion.value.motion,
    config: config.data,
    policy,
  });
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    value: {
      config: config.data,
      specification: spec.data,
      motion: motion.value.motion,
      checks: scheduledChecks(config.data, spec.data),
    },
  };
}

function validateMappings(options: {
  specification: TestSpecification;
  motion: Motion;
  config: RepositoryConfig;
  policy: TestPreparationPolicy;
}): Outcome<void> {
  const { specification, motion, config, policy } = options;
  const criteria = new Set(
    motion.acceptance_criteria.map((item) => item.criterion_id),
  );
  const mappings = specification.mappings;
  if (
    mappings.length !== criteria.size ||
    new Set(mappings.map((item) => item.criterion_id)).size !== criteria.size ||
    mappings.some((item) => !criteria.has(item.criterion_id))
  )
    return failure(
      "EVIDENCE_INVALID",
      "Every acceptance criterion requires exactly one mapping.",
    );
  for (const mapping of mappings) {
    const command = config.commands.find(
      (item) => item.check_id === mapping.check_id,
    );
    if (!command || command.report_format !== "quorum-json-v1")
      return failure(
        "CAPABILITY_MISSING",
        "Mapped checks require configured structured reporting.",
      );
    const expectedKind =
      mapping.expectation === "compiler"
        ? "typecheck"
        : mapping.expectation === "documentation"
          ? "documentation"
          : "test";
    if (
      command.kind !== expectedKind ||
      !expectationAllowed(mapping.expectation, policy.changeKind)
    )
      return failure(
        "SCOPE_DENIED",
        "Check expectation does not match host policy or configured tool kind.",
      );
  }
  if (
    policy.changeKind === "documentation" &&
    config.commands.some((command) => command.kind !== "documentation")
  )
    return failure(
      "SCOPE_DENIED",
      "Documentation exceptions require a documentation-only check configuration.",
    );
  return { ok: true, value: undefined };
}

function expectationAllowed(
  expectation: TestSpecification["mappings"][number]["expectation"],
  kind: TestPreparationPolicy["changeKind"],
): boolean {
  if (kind === "refactor") return expectation === "regression";
  if (kind === "documentation") return expectation === "documentation";
  return (
    expectation === "behavioral" ||
    (kind === "contract" && expectation === "compiler")
  );
}
function orderChecks(a: { checkId: string }, b: { checkId: string }): number {
  return a.checkId < b.checkId ? -1 : a.checkId === b.checkId ? 0 : 1;
}

function validatePreparationPolicy(
  policy: TestPreparationPolicy,
  config: RepositoryConfig,
  motion: Motion,
): Outcome<void> {
  if (
    config.mode !== "enforced" ||
    !gitObject.safeParse(policy.baselineTree).success ||
    !policy.testPaths.length ||
    !policy.testPaths.every((path) => repositoryPath.safeParse(path).success)
  )
    return failure(
      "SCOPE_DENIED",
      "Missing host preparation policy or test grants.",
    );
  if (
    !policy.testPaths.every((path) =>
      config.paths.tests.some((root) => pathWithin(path, root)),
    ) ||
    !policy.implementationPaths.every((path) =>
      config.paths.implementation.some((root) => pathWithin(path, root)),
    )
  )
    return failure(
      "SCOPE_DENIED",
      "Host grants exceed the frozen repository configuration.",
    );
  if (
    (motion.risk === "documentation") !==
      (policy.changeKind === "documentation") ||
    (motion.risk === "refactor") !== (policy.changeKind === "refactor")
  )
    return failure(
      "SCOPE_DENIED",
      "QA cannot change the host-approved change classification.",
    );
  if (
    config.commands.some(
      (command) => command.report_format !== "quorum-json-v1",
    ) ||
    (motion.fuzz_required &&
      !config.commands.some((command) => command.kind === "fuzz"))
  )
    return failure(
      "CAPABILITY_MISSING",
      "Required baseline reporting or fuzz capability is missing.",
    );
  return { ok: true, value: undefined };
}

function scheduledChecks(
  config: RepositoryConfig,
  spec: TestSpecification,
): TestPreparationPlan["checks"] {
  const checks = config.commands
    .map((command) => ({
      phase: "baseline" as const,
      checkId: command.check_id,
    }))
    .sort(orderChecks);
  const redIds = [
    ...new Set(spec.mappings.map((mapping) => mapping.check_id)),
  ].sort();
  return [
    ...checks,
    ...redIds.map((checkId) => ({ phase: "expected_red" as const, checkId })),
  ];
}
