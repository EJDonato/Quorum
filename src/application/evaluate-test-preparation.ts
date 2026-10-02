import { testPreparationReceiptSchema } from "../contracts/test-specification.js";
import { checkResultSchema } from "../contracts/checks.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { checkPassed, expectedRed } from "../domain/checks.js";
import { readEvidence, type EvidencePort } from "./evidence.js";
import {
  validatePreparationInput,
  type TestPreparationInput,
} from "./test-preparation-input.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
type ValidatedPreparation = Extract<
  ReturnType<typeof validatePreparationInput>,
  { ok: true }
>["value"];
export interface TestPreparationEvaluation extends TestPreparationInput {
  receipt: unknown;
  ports: EvidencePort;
}
export async function evaluateTestPreparation(
  options: TestPreparationEvaluation,
): Promise<Outcome<void>> {
  const ready = validatePreparationInput(options, options.ports);
  if (!ready.ok) return ready;
  const parsed = testPreparationReceiptSchema.safeParse(options.receipt);
  if (!parsed.success)
    return failure("EVIDENCE_INVALID", "Malformed preparation receipt.");
  const receipt = parsed.data;
  const r = ready.value;
  if (
    receipt.session_id !== options.policy.sessionId ||
    receipt.motion_digest !== r.motionDigest ||
    receipt.specification_digest !== r.specificationDigest ||
    receipt.baseline_input_digest !== r.baseline.input_digest ||
    receipt.expected_red_input_digest !== r.expectedRed.input_digest ||
    receipt.checks.length !== r.checks.length
  )
    return failure(
      "STALE_INPUT",
      "Preparation receipt differs from required evidence.",
    );
  const seen = new Set<string>();
  for (const expected of r.checks) {
    const matches = receipt.checks.filter(
      (item) =>
        item.phase === expected.phase && item.check_id === expected.checkId,
    );
    const reference = matches[0];
    if (
      matches.length !== 1 ||
      !reference ||
      seen.has(reference.ref.artifact_id)
    )
      return failure(
        "EVIDENCE_INVALID",
        "Preparation evidence is missing, duplicated, or reused.",
      );
    seen.add(reference.ref.artifact_id);
    const checked = await verifyPreparationCheck({
      ready: r,
      reference: reference.ref,
      expected,
      ports: options.ports,
    });
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

export async function verifyPreparationCheck(options: {
  ready: ValidatedPreparation;
  reference: ArtifactReference;
  expected: ValidatedPreparation["checks"][number];
  ports: EvidencePort;
}): Promise<Outcome<void>> {
  const { ready: r, expected, ports } = options;
  const check = await readEvidence({
    ref: options.reference,
    schema: checkResultSchema,
    port: ports,
  });
  if (!check.ok) return check;
  const input = expected.phase === "baseline" ? r.baseline : r.expectedRed;
  const command = r.config.commands.find(
    (item) => item.check_id === expected.checkId,
  );
  const commandHash = ports.digest(command);
  const c = check.value;
  if (
    !command ||
    !commandHash.ok ||
    c.session_id !== input.identity.session_id ||
    c.check_id !== expected.checkId ||
    c.input.phase !== expected.phase ||
    !("input_digest" in c.input) ||
    c.input.input_digest !== input.input_digest ||
    c.command_digest !== commandHash.value ||
    c.environment_digest !== input.identity.environment_digest ||
    c.kind !== command.kind
  )
    return failure(
      "EVIDENCE_INVALID",
      "Preparation check identity differs from its required execution.",
    );
  return checkSatisfies(c, r.specification, expected.phase)
    ? { ok: true, value: undefined }
    : failure(
        "CHECK_FAILED",
        "Baseline or expected failure evidence does not satisfy the test specification.",
      );
}

function checkSatisfies(
  check: import("../contracts/checks.js").CheckResult,
  spec: import("../contracts/test-specification.js").TestSpecification,
  phase: "baseline" | "expected_red",
): boolean {
  if (phase === "baseline") return checkPassed(check);
  const mappings = spec.mappings.filter(
    (item) => item.check_id === check.check_id,
  );
  const expectedIds = mappings.flatMap((item) =>
    "expected_failure_id" in item ? [item.expected_failure_id] : [],
  );
  if (!expectedIds.length) return checkPassed(check);
  const observed = check.failure_ids ?? [];
  return (
    expectedRed(check) &&
    observed.length > 0 &&
    new Set(observed).size === observed.length &&
    expectedIds.every((id) => observed.includes(id)) &&
    observed.every((id) => expectedIds.includes(id))
  );
}
