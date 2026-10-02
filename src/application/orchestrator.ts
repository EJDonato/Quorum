import { executeFinalize } from "./workflow-finalization.js";
import { verifyWorkflowPrerequisites } from "./workflow-prerequisites.js";
import { verifyWorkflowTestPreparation } from "./workflow-test-preparation.js";
import { ensurePrivateDirectory } from "../infrastructure/workspace/directories.js";
import { join } from "node:path";
import { failure, type Outcome } from "../contracts/errors.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import {
  acquireCommandLock,
  acquireSessionLease,
  releaseCommandLock,
  releaseSessionLease,
  updateSessionLeaseStatus,
} from "../infrastructure/storage/locks.js";
import { createSessionWorkspace } from "../infrastructure/workspace/manager.js";
import { freezeCandidate } from "./freeze.js";
import { advanceWorkflow as advance } from "./workflow-state.js";
import {
  createInitialSessionState,
  type OrchestratorOptions,
  type SessionRunResult,
  type WorkflowContext,
} from "./session-init.js";

export type { OrchestratorOptions, SessionRunResult };

export async function runSession(
  options: OrchestratorOptions,
): Promise<Outcome<SessionRunResult>> {
  const prerequisites = await verifyWorkflowPrerequisites(options);
  if (!prerequisites.ok) return prerequisites;
  const quorumDir = join(options.rootDir, ".quorum");
  try {
    await ensurePrivateDirectory(options.rootDir, ".quorum");
  } catch {
    return failure(
      "SCOPE_DENIED",
      "Private session root is linked or unavailable.",
    );
  }
  const leasePath = join(quorumDir, "lease.json");
  const lockPath = join(quorumDir, "command.lock");

  const lease = await acquireSessionLease(leasePath, options.sessionId);
  if (!lease.ok) return lease;

  const lock = await acquireCommandLock(lockPath, {
    sessionId: options.sessionId,
  });
  if (!lock.ok) {
    await releaseSessionLease(leasePath, options.sessionId);
    return lock;
  }

  return runLockedWorkflow(options, {
    leasePath,
    lockPath,
    nonce: lock.value.nonce,
  });
}

async function runLockedWorkflow(
  options: OrchestratorOptions,
  locks: {
    leasePath: string;
    lockPath: string;
    nonce: string;
  },
): Promise<Outcome<SessionRunResult>> {
  let result: Outcome<SessionRunResult>;
  try {
    result = await executeSessionWorkflow(options);
  } catch {
    result = failure(
      "STORAGE_FAILED",
      "Workflow effect failed; work was preserved.",
    );
  }
  const status = await updateSessionLeaseStatus(
    locks.leasePath,
    options.sessionId,
    result.ok ? "COMPLETED" : "BLOCKED",
  );
  const release = await releaseCommandLock(locks.lockPath, locks.nonce);
  if (!status.ok) return status;
  return release.ok ? result : release;
}

async function executeSessionWorkflow(
  options: OrchestratorOptions,
): Promise<Outcome<SessionRunResult>> {
  const workspace = await createSessionWorkspace({
    rootDir: options.rootDir,
    sessionId: options.sessionId,
    sourceDir: options.sourceDir,
    baseSha: options.baseSha,
  });
  if (!workspace.ok) return workspace;

  const input = canonicalDigest({
    source: options.sourceDir,
    base: options.baseSha,
    identity: options.verification?.identity,
  });
  if (!input.ok) return input;
  const ctx: WorkflowContext = {
    options,
    workspace: workspace.value,
    sessionDir: join(options.rootDir, ".quorum", "sessions", options.sessionId),
    initial: createInitialSessionState({
      ...options,
      repositoryId: input.value.slice(7),
      inputDigest: input.value,
    }),
    ports: { digest: canonicalDigest },
  };

  const p1 = await advance(ctx, { type: "PREFLIGHT_COMPLETED" });
  if (!p1.ok) return p1;
  if (options.hooks.onPlan && !(await options.hooks.onPlan(ctx.workspace)).ok) {
    return failure("CHECK_FAILED", "Planning stage failed.");
  }

  const p2 = await advance(ctx, {
    type: "PLAN_ACCEPTED",
    design_required: false,
  });
  if (!p2.ok) return p2;
  if (
    options.hooks.onTestAuthor &&
    !(await options.hooks.onTestAuthor(ctx.workspace)).ok
  ) {
    return failure("CHECK_FAILED", "Test spec authoring failed.");
  }

  return executeExecutionLoop(ctx);
}

async function requestRepair(
  ctx: WorkflowContext,
  stage: "IMPLEMENTING",
  reason: string,
): Promise<Outcome<boolean>> {
  const rep = await advance(ctx, { type: "REPAIR_REQUESTED", stage, reason });
  if (!rep.ok) return rep;
  if (rep.value.state === "BLOCKED") {
    return failure(
      "BUDGET_EXHAUSTED",
      rep.value.blocking_reason ?? "Repair budget exhausted",
    );
  }
  return { ok: true, value: true };
}

async function freezeCandidateRecord(ctx: WorkflowContext) {
  const identity = ctx.options.verification?.identity;
  if (!identity)
    return failure("CAPABILITY_MISSING", "Missing frozen input identity.");
  return freezeCandidate({
    sessionId: ctx.options.sessionId,
    draftDir: ctx.workspace.draftDir,
    artifactsDir: ctx.workspace.workspaceDir,
    baseSha: ctx.options.baseSha,
    objectFormat: ctx.options.objectFormat,
    policyHash: identity.policy_hash,
    configDigest: identity.configuration_digest,
    planDigest: identity.plan_digest,
    acceptanceDigest: identity.acceptance_digest,
    contractDigest: identity.contract_digest,
    testsDigest: identity.tests_digest,
    envDigest: identity.validation_environment_digest,
    adapter: identity.adapter,
    personaDigest: identity.persona_digest,
  });
}

async function validateAndReview(
  ctx: WorkflowContext,
  candidateId: string,
): Promise<Outcome<"PASS" | "REPAIR">> {
  if (ctx.options.hooks.onValidate) {
    const val = await ctx.options.hooks.onValidate(ctx.workspace, candidateId);
    if (!val.ok) return { ok: true, value: "REPAIR" };
  }
  const pChecks = await advance(ctx, { type: "CHECKS_COMPLETED" });
  if (!pChecks.ok) return pChecks;

  if (ctx.options.hooks.onReview) {
    const rev = await ctx.options.hooks.onReview(ctx.workspace, candidateId);
    if (!rev.ok) return { ok: true, value: "REPAIR" };
  }
  return { ok: true, value: "PASS" };
}

async function executeExecutionLoop(
  ctx: WorkflowContext,
): Promise<Outcome<SessionRunResult>> {
  const preparation = await verifyWorkflowTestPreparation(ctx);
  if (!preparation.ok) return preparation;
  const p3 = await advance(ctx, { type: "TEST_SPEC_ACCEPTED" });
  if (!p3.ok) return p3;

  while (true) {
    if (
      ctx.options.hooks.onImplement &&
      !(await ctx.options.hooks.onImplement(ctx.workspace)).ok
    ) {
      return failure("CHECK_FAILED", "Implementation stage failed.");
    }
    const frozen = await freezeCandidateRecord(ctx);
    if (!frozen.ok) return frozen;

    const pFreeze = await advance(ctx, {
      type: "CANDIDATE_FROZEN",
      candidate_id: frozen.value.manifest.candidate_id,
    });
    if (!pFreeze.ok) return pFreeze;

    const verdict = await validateAndReview(
      ctx,
      frozen.value.manifest.candidate_id,
    );
    if (!verdict.ok) return verdict;
    if (verdict.value === "REPAIR") {
      const rep = await requestRepair(
        ctx,
        "IMPLEMENTING",
        "Checks or reviews requested repair",
      );
      if (!rep.ok) return rep;
      continue;
    }
    return executeFinalize(ctx, frozen.value);
  }
}
