import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CandidateManifest } from "../contracts/candidate.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { TransitionInput } from "../contracts/events.js";
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
import { finalizeSession } from "./finalize.js";
import { recordSessionTransition } from "./session-control.js";
import {
  createInitialSessionState,
  type OrchestratorOptions,
  type SessionRunResult,
  type WorkflowContext,
} from "./session-init.js";

export type { OrchestratorOptions, SessionRunResult };

function advance(ctx: WorkflowContext, payload: TransitionInput) {
  return recordSessionTransition({
    sessionDir: ctx.sessionDir,
    initial: ctx.initial,
    payload,
    ports: ctx.ports,
  });
}

export async function runSession(
  options: OrchestratorOptions,
): Promise<Outcome<SessionRunResult>> {
  const quorumDir = join(options.rootDir, ".quorum");
  await mkdir(quorumDir, { recursive: true });
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

  try {
    const result = await executeSessionWorkflow(options);
    await updateSessionLeaseStatus(
      leasePath,
      options.sessionId,
      result.ok ? "COMPLETED" : "BLOCKED",
    );
    return result;
  } finally {
    await releaseCommandLock(lockPath, lock.value.nonce);
  }
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

  const ctx: WorkflowContext = {
    options,
    workspace: workspace.value,
    sessionDir: join(options.rootDir, ".quorum", "sessions", options.sessionId),
    initial: createInitialSessionState(options),
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
  const zero =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  return freezeCandidate({
    sessionId: ctx.options.sessionId,
    draftDir: ctx.workspace.draftDir,
    artifactsDir: ctx.workspace.workspaceDir,
    baseSha: ctx.options.baseSha,
    objectFormat: ctx.options.objectFormat,
    policyHash: zero,
    configDigest: zero,
    planDigest: zero,
    acceptanceDigest: zero,
    contractDigest: zero,
    testsDigest: zero,
    envDigest: zero,
    adapter: {
      name: "agy",
      version: "1.2.14",
      model: "gemini",
      model_version: "3.8",
    },
    personaDigest: zero,
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

async function executeFinalize(
  ctx: WorkflowContext,
  frozen: { manifest: CandidateManifest; diff: string },
): Promise<Outcome<SessionRunResult>> {
  const p6 = await advance(ctx, { type: "BALLOT_APPROVED" });
  if (!p6.ok) return p6;

  const p7 = await advance(ctx, { type: "FINALIZATION_STARTED" });
  if (!p7.ok) return p7;

  const artId = "art0000000000000000000000001";
  const fin = await finalizeSession({
    sessionId: ctx.options.sessionId,
    sourceDir: ctx.options.sourceDir,
    draftDir: ctx.workspace.draftDir,
    artifactsDir: ctx.workspace.workspaceDir,
    candidateId: frozen.manifest.candidate_id,
    treeOid: frozen.manifest.identity.tree.oid,
    baseSha: ctx.options.baseSha,
    objectFormat: ctx.options.objectFormat,
    evidenceRefs: [
      { artifact_id: artId, digest: frozen.manifest.candidate_id },
    ],
  });
  if (!fin.ok) return fin;

  const p8 = await advance(ctx, { type: "FINALIZATION_COMPLETED" });
  if (!p8.ok) return p8;

  return {
    ok: true,
    value: {
      sessionId: ctx.options.sessionId,
      state: p8.value,
      candidateId: frozen.manifest.candidate_id,
      receipt: fin.value.receipt,
    },
  };
}
