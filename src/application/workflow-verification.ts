import type { RepositoryConfig } from "../contracts/config.js";
import { type Outcome } from "../contracts/errors.js";
import type { TestPreparationEvaluation } from "./evaluate-test-preparation.js";
import type { WorkflowVerification } from "./session-init.js";
import type { WorkspacePaths } from "../infrastructure/workspace/manager.js";
import {
  readSourceRepositoryInfo,
  writeDraftTree,
} from "../infrastructure/git/operations.js";
import { readBaselineTree } from "../infrastructure/validation/qa-overlay.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import { validationEnvironment } from "./validation-input.js";
import { createCandidateEvidence } from "./workflow-evidence-builders.js";
import {
  buildPreparationChecks,
  buildPreparationResult,
  buildSnapshots,
  updateVerificationIdentity,
} from "./workflow-preparation-builders.js";

export interface CreateWorkflowVerificationOptions {
  rootDir: string;
  config: RepositoryConfig;
  sessionId: string;
  inputDigest: string;
  personaDigest?: string;
}

export function createWorkflowVerification(
  options: CreateWorkflowVerificationOptions,
): WorkflowVerification {
  const policyDigest = canonicalDigest(options.config.paths);
  const configDigest = canonicalDigest(options.config);
  const policyHash = policyDigest.ok ? policyDigest.value : options.inputDigest;
  const configurationDigest = configDigest.ok
    ? configDigest.value
    : options.inputDigest;

  const identity: WorkflowVerification["identity"] = {
    policy_hash: policyHash,
    configuration_digest: configurationDigest,
    plan_digest: options.inputDigest,
    acceptance_digest: options.inputDigest,
    contract_digest: options.inputDigest,
    tests_digest: options.inputDigest,
    validation_environment_digest: options.inputDigest,
    persona_digest: options.personaDigest ?? options.inputDigest,
    adapter: {
      ...options.config.adapter,
      model_version: options.config.adapter.model,
    },
  };

  return {
    preflight: async () => {
      const repo = await readSourceRepositoryInfo(options.rootDir);
      return repo.ok ? { ok: true, value: undefined } : repo;
    },
    identity,
    testPreparation: async (workspace) =>
      prepareWorkspaceTests(workspace, options, identity),
    evidence: (candidate) => createCandidateEvidence(candidate, options),
  };
}

async function prepareWorkspaceTests(
  workspace: WorkspacePaths,
  options: CreateWorkflowVerificationOptions,
  identity: WorkflowVerification["identity"],
): Promise<Outcome<TestPreparationEvaluation>> {
  const trees = await loadWorkspaceTrees(workspace);
  if (!trees.ok) return trees;

  const envVal = validationEnvironment(options.config, {});
  const envHash = canonicalDigest(envVal);
  const envDigest = envHash.ok ? envHash.value : options.inputDigest;

  const snapshots = buildSnapshots({
    options,
    identity,
    baselineTree: trees.value.baseline,
    redOid: trees.value.current.treeOid,
    envDigest,
  });
  if (!snapshots.ok) return snapshots;

  const { baseSnap, redSnap } = snapshots.value;
  const { checks, artifacts } = buildPreparationChecks({
    options,
    baseSnap,
    redSnap,
    envDigest,
  });

  updateVerificationIdentity(identity, baseSnap, redSnap);

  return {
    ok: true,
    value: buildPreparationResult({
      options,
      baselineTree: trees.value.baseline,
      baseSnap,
      redSnap,
      checks,
      artifacts,
    }),
  };
}

async function loadWorkspaceTrees(workspace: WorkspacePaths) {
  const source = await readSourceRepositoryInfo(workspace.draftDir);
  if (!source.ok) return source;
  const baseline = await readBaselineTree({
    repository: workspace.draftDir,
    baseCommit: {
      format: source.value.objectFormat,
      oid: source.value.headSha,
    },
  });
  if (!baseline.ok) return baseline;
  const current = await writeDraftTree(workspace.draftDir);
  if (!current.ok) return current;
  return {
    ok: true as const,
    value: { baseline: baseline.value, current: current.value },
  };
}
