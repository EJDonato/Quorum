import { failure, type Outcome } from "../contracts/errors.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import type {
  PreparationSnapshot,
  TestPreparationReceipt,
} from "../contracts/test-specification.js";
import type { EvidencePort } from "./evidence.js";
import {
  evaluateTestPreparation,
  verifyPreparationCheck,
} from "./evaluate-test-preparation.js";
import {
  validatePreparationInput,
  type TestPreparationInput,
} from "./test-preparation-input.js";

export interface TestPreparationPorts extends EvidencePort {
  verifyOverlay: (options: {
    baseline: PreparationSnapshot;
    expectedRed: PreparationSnapshot;
    testPaths: string[];
  }) => Promise<Outcome<void>>;
  runCheck: (options: {
    snapshot: PreparationSnapshot;
    checkId: string;
  }) => Promise<Outcome<ArtifactReference>>;
  persistReceipt: (
    receipt: TestPreparationReceipt,
  ) => Promise<Outcome<ArtifactReference>>;
}
export async function scheduleTestPreparation(
  options: TestPreparationInput & {
    ports: TestPreparationPorts;
  },
): Promise<
  Outcome<{ receipt: TestPreparationReceipt; reference: ArtifactReference }>
> {
  const ready = validatePreparationInput(options, options.ports);
  if (!ready.ok) return ready;
  const r = ready.value;
  const overlay = await options.ports.verifyOverlay({
    baseline: r.baseline,
    expectedRed: r.expectedRed,
    testPaths: [...options.policy.testPaths],
  });
  if (!overlay.ok) return overlay;
  const checks: TestPreparationReceipt["checks"] = [];
  for (const expected of r.checks) {
    const snapshot = expected.phase === "baseline" ? r.baseline : r.expectedRed;
    const result = await options.ports.runCheck({
      snapshot,
      checkId: expected.checkId,
    });
    if (!result.ok) return result;
    const checked = await verifyPreparationCheck({
      ready: r,
      reference: result.value,
      expected,
      ports: options.ports,
    });
    if (!checked.ok) return checked;
    checks.push({
      phase: expected.phase,
      check_id: expected.checkId,
      ref: result.value,
    });
  }
  const receipt: TestPreparationReceipt = {
    schema_version: "1.0.0",
    session_id: options.policy.sessionId,
    motion_digest: r.motionDigest,
    specification_digest: r.specificationDigest,
    baseline_input_digest: r.baseline.input_digest,
    expected_red_input_digest: r.expectedRed.input_digest,
    checks,
  };
  const evaluated = await evaluateTestPreparation({ ...options, receipt });
  if (!evaluated.ok) return evaluated;
  const stored = await options.ports.persistReceipt(receipt);
  if (!stored.ok) return stored;
  const hashed = options.ports.digest(receipt);
  if (!hashed.ok || stored.value.digest !== hashed.value)
    return failure(
      "EVIDENCE_INVALID",
      "Saved preparation receipt digest differs.",
    );
  return { ok: true, value: { receipt, reference: stored.value } };
}
