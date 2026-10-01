// Explicitly fake host ports: these never prove production enforcement capability.
import assert from "node:assert/strict";
import type { CandidateManifest } from "../../src/contracts/candidate.js";
import type { WorkflowVerification } from "../../src/application/session-init.js";
import type { BallotEvaluation } from "../../src/application/finalize.js";
import {
  identity,
  fakeBallotFixture,
  passingCheck,
  review,
  request,
  invocation,
} from "./evidence.js";
import { createInitialSessionState } from "../../src/application/session-init.js";

export function fakeEvaluation(candidate: CandidateManifest): BallotEvaluation {
  const fixture = fakeBallotFixture();
  const sessionId = candidate.identity.session_id;
  const id = candidate.candidate_id;
  const check = passingCheck();
  check.session_id = sessionId;
  check.input = { phase: "final", candidate_id: id };
  check.environment_digest = candidate.identity.validation_environment_digest;
  const checkRef = fixture.put("check", check);
  const refs = ["qa", "security"].map((roleName) => {
    assert.ok(roleName === "qa" || roleName === "security");
    const role = roleName;
    const record = review(role, checkRef);
    record.session_id = sessionId;
    record.subject = { phase: "final", role, candidate_id: id };
    const ref = fixture.put(role, record);
    const req = request(role);
    req.session_id = sessionId;
    req.assignment = { phase: "final", role, candidate_id: id };
    req.input_refs = [{ artifact_id: "candidate", digest: id }];
    const inv = invocation(role, ref);
    inv.session_id = sessionId;
    return {
      kind: "review" as const,
      ref,
      request_ref: fixture.put(`request-${role}`, req),
      invocation_ref: fixture.put(`result-${role}`, inv),
    };
  });
  return {
    candidate,
    session: {
      ...createInitialSessionState({
        sessionId,
        repositoryId: "fake-repository",
        inputDigest: candidate.identity.configuration_digest,
        baseSha: candidate.identity.base_commit.oid,
        objectFormat: candidate.identity.tree.format,
      }),
      state: "APPROVED",
      current_candidate_id: id,
    },
    requirements: {
      ...fixture.requirements,
      policy_hash: candidate.identity.policy_hash,
    },
    evidenceRefs: [{ kind: "check", ref: checkRef }, ...refs],
    ports: fixture.ports,
  };
}

export function fakeWorkflowVerification(): WorkflowVerification {
  return {
    preflight: () => Promise.resolve({ ok: true, value: undefined }),
    identity,
    evidence: (candidate) =>
      Promise.resolve({ ok: true, value: fakeEvaluation(candidate) }),
  };
}

export function fakeStageHooks() {
  const pass = () => Promise.resolve({ ok: true as const, value: undefined });
  return {
    onPlan: pass,
    onTestAuthor: pass,
    onImplement: pass,
    onValidate: pass,
    onReview: pass,
  };
}
