import type { CandidateManifest } from "../contracts/candidate.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { WorkflowContext, SessionRunResult } from "./session-init.js";
import { finalizeSession } from "./finalize.js";
import { evaluateBallot } from "./evaluate-ballot.js";
import {
  advanceWorkflow as advance,
  readWorkflowState,
} from "./workflow-state.js";

export async function executeFinalize(
  ctx: WorkflowContext,
  frozen: { manifest: CandidateManifest; diff: string },
): Promise<Outcome<SessionRunResult>> {
  if (!ctx.options.verification)
    return failure("CAPABILITY_MISSING", "Missing evidence verifier.");
  const evidence = await ctx.options.verification.evidence(frozen.manifest);
  if (!evidence.ok) return evidence;
  const state = await readWorkflowState(ctx);
  if (!state.ok) return state;
  const verification = {
    ...evidence.value,
    session: state.value,
    candidate: frozen.manifest,
  };
  const ballot = await evaluateBallot(verification);
  if (!ballot.ok) return ballot;
  if (!ballot.value.quorum_achieved)
    return failure(
      "REVIEW_REJECTED",
      `Ballot blocked: ${ballot.value.reason_codes.join(", ")}`,
    );
  const p6 = await advance(ctx, { type: "BALLOT_APPROVED" });
  if (!p6.ok) return p6;
  if (!ctx.options.commit)
    return approvedResult(ctx, frozen.manifest, p6.value);
  const p7 = await advance(ctx, { type: "FINALIZATION_STARTED" });
  if (!p7.ok) return p7;
  const fin = await finalizeSession({
    sessionId: ctx.options.sessionId,
    sourceDir: ctx.options.sourceDir,
    draftDir: ctx.workspace.draftDir,
    artifactsDir: ctx.workspace.workspaceDir,
    candidateId: frozen.manifest.candidate_id,
    treeOid: frozen.manifest.identity.tree.oid,
    baseSha: ctx.options.baseSha,
    objectFormat: ctx.options.objectFormat,
    evidenceRefs: ballot.value.evidence,
    verification,
    loadSession: () => readWorkflowState(ctx),
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

function approvedResult(
  ctx: WorkflowContext,
  manifest: CandidateManifest,
  state: SessionRunResult["state"],
): Outcome<SessionRunResult> {
  return {
    ok: true,
    value: {
      sessionId: ctx.options.sessionId,
      state,
      candidateId: manifest.candidate_id,
    },
  };
}
