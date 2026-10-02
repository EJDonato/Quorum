import type { ArtifactReference } from "../contracts/ballot-input.js";
import type { PreparationSnapshot } from "../contracts/test-specification.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import { createPreparationSnapshot } from "./preparation-snapshots.js";
import { createFakePlan } from "../domain/fake-roles.js";
import type { CreateWorkflowVerificationOptions } from "./workflow-verification.js";
import type { WorkflowVerification } from "./session-init.js";
import {
  createCheckRecord,
  createEvidencePorts,
} from "./workflow-evidence-builders.js";

export function buildSnapshots(opts: {
  options: CreateWorkflowVerificationOptions;
  identity: WorkflowVerification["identity"];
  baselineTree: { format: "sha1" | "sha256"; oid: string };
  redOid: string;
  envDigest: string;
}) {
  const identBase = {
    schema_version: "1.0.0" as const,
    session_id: opts.options.sessionId,
    baseline_tree: opts.baselineTree,
    configuration_digest: opts.identity.configuration_digest,
    environment_digest: opts.envDigest,
    motion_digest: opts.options.inputDigest,
    specification_digest: opts.options.inputDigest,
  };
  const baseSnap = createPreparationSnapshot(
    { ...identBase, phase: "baseline" as const, tree: opts.baselineTree },
    { digest: canonicalDigest },
  );
  if (!baseSnap.ok) return baseSnap;
  const redSnap = createPreparationSnapshot(
    {
      ...identBase,
      phase: "expected_red" as const,
      tree: { ...opts.baselineTree, oid: opts.redOid },
    },
    { digest: canonicalDigest },
  );
  if (!redSnap.ok) return redSnap;
  return {
    ok: true as const,
    value: { baseSnap: baseSnap.value, redSnap: redSnap.value },
  };
}

export function buildPreparationChecks(opts: {
  options: CreateWorkflowVerificationOptions;
  baseSnap: PreparationSnapshot;
  redSnap: PreparationSnapshot;
  envDigest: string;
}) {
  const artifacts = new Map<string, unknown>();
  const put = (id: string, val: unknown): ArtifactReference => {
    artifacts.set(id, val);
    const h = canonicalDigest(val);
    return {
      artifact_id: id,
      digest: h.ok ? h.value : opts.options.inputDigest,
    };
  };

  const checkId = opts.options.config.commands[0]?.check_id ?? "test";
  const cmdHash = canonicalDigest(opts.options.config.commands[0]);
  const cmdDigest = cmdHash.ok ? cmdHash.value : opts.options.inputDigest;

  const checks = [opts.baseSnap, opts.redSnap].map((snap) => {
    const record = createCheckRecord({
      sessionId: opts.options.sessionId,
      checkId,
      phase: snap.identity.phase,
      inputDigest: snap.input_digest,
      commandDigest: cmdDigest,
      environmentDigest: opts.envDigest,
    });
    return {
      phase: snap.identity.phase,
      check_id: checkId,
      ref: put(`check-${snap.identity.phase}`, record),
    };
  });

  return { checks, artifacts };
}

export function updateVerificationIdentity(
  identity: WorkflowVerification["identity"],
  baseSnap: PreparationSnapshot,
  redSnap: PreparationSnapshot,
) {
  identity.plan_digest = baseSnap.identity.motion_digest;
  identity.acceptance_digest = baseSnap.identity.specification_digest;
  identity.tests_digest = redSnap.input_digest;
  identity.configuration_digest = baseSnap.identity.configuration_digest;
  identity.validation_environment_digest = baseSnap.identity.environment_digest;
}

export function buildPreparationResult(opts: {
  options: CreateWorkflowVerificationOptions;
  baselineTree: { format: "sha1" | "sha256"; oid: string };
  baseSnap: PreparationSnapshot;
  redSnap: PreparationSnapshot;
  checks: Array<{
    phase: "baseline" | "expected_red";
    check_id: string;
    ref: ArtifactReference;
  }>;
  artifacts: Map<string, unknown>;
}) {
  const motion = createFakePlan(opts.options.sessionId);
  const criterionId =
    motion.acceptance_criteria[0]?.criterion_id ??
    "crit00000000000000000000001";
  return {
    config: opts.options.config,
    motion,
    specification: {
      schema_version: "1.0.0" as const,
      motion_digest: opts.options.inputDigest,
      mappings: [
        {
          criterion_id: criterionId,
          check_id: opts.options.config.commands[0]?.check_id ?? "test",
          expectation: "regression" as const,
          justification: "Host-verified baseline regression criteria",
        },
      ],
    },
    baseline: opts.baseSnap,
    expectedRed: opts.redSnap,
    environment: {},
    policy: {
      sessionId: opts.options.sessionId,
      changeKind: "refactor" as const,
      baselineTree: opts.baselineTree,
      implementationPaths: opts.options.config.paths.implementation,
      protectedPaths: opts.options.config.paths.protected,
      testPaths: opts.options.config.paths.tests,
    },
    ports: createEvidencePorts(opts.artifacts),
    receipt: {
      schema_version: "1.0.0" as const,
      session_id: opts.options.sessionId,
      motion_digest: opts.options.inputDigest,
      specification_digest: opts.options.inputDigest,
      baseline_input_digest: opts.baseSnap.input_digest,
      expected_red_input_digest: opts.redSnap.input_digest,
      checks: opts.checks,
    },
  };
}
