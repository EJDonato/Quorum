import type { Ballot, BallotReason } from "../contracts/ballot.js";
import type {
  BallotRequirements,
  ArtifactReference,
} from "../contracts/ballot-input.js";
import type { CandidateManifest } from "../contracts/candidate.js";
import type { CheckResult } from "../contracts/checks.js";
import type { ReviewResult } from "../contracts/reviews.js";
import type { SessionState } from "../contracts/session.js";
import { checkPassed } from "./checks.js";

export interface BallotFacts {
  session: SessionState;
  candidate: CandidateManifest;
  requirements: BallotRequirements;
  checks: { ref: ArtifactReference; record: CheckResult }[];
  reviews: {
    ref: ArtifactReference;
    requestRef: ArtifactReference;
    invocationRef: ArtifactReference;
    record: ReviewResult;
  }[];
  // Set only by the trusted host's prerequisite verifier, never a role body.
  prerequisitesComplete: boolean;
}

function checkReasons(facts: BallotFacts): BallotReason[] {
  const reasons: BallotReason[] = [];
  const ids = facts.checks.map(({ record }) => record.check_id);
  if (new Set(ids).size !== ids.length) reasons.push("EVIDENCE_INVALID");
  for (const requirement of facts.requirements.required_checks) {
    const check = facts.checks.find(
      ({ record }) => record.check_id === requirement.check_id,
    )?.record;
    if (!check) {
      reasons.push("CHECK_MISSING");
      continue;
    }
    if (
      check.kind !== requirement.kind ||
      check.command_digest !== requirement.command_digest
    )
      reasons.push("EVIDENCE_INVALID");
    if (!checkPassed(check)) reasons.push("CHECK_FAILED");
  }
  for (const { record } of facts.checks) {
    if (
      record.session_id !== facts.session.session_id ||
      record.input.phase !== "final" ||
      record.input.candidate_id !== facts.candidate.candidate_id ||
      record.environment_digest !==
        facts.candidate.identity.validation_environment_digest
    ) {
      reasons.push("EVIDENCE_INVALID");
    }
    if (!checkPassed(record)) reasons.push("CHECK_FAILED");
  }
  return reasons;
}

function reviewReasons(facts: BallotFacts): BallotReason[] {
  const reasons: BallotReason[] = [];
  const roles = facts.reviews.map(({ record }) => record.subject.role);
  const invocationIds = facts.reviews.map(({ record }) => record.invocation_id);
  if (
    new Set(roles).size !== roles.length ||
    new Set(invocationIds).size !== invocationIds.length
  )
    reasons.push("EVIDENCE_INVALID");
  for (const role of ["qa", "security"] as const) {
    if (
      !facts.reviews.some(
        ({ record }) =>
          record.subject.phase === "final" && record.subject.role === role,
      )
    )
      reasons.push(role === "qa" ? "QA_MISSING" : "SECURITY_MISSING");
  }
  const checks = new Map(
    facts.checks.map(({ ref }) => [ref.artifact_id, ref.digest]),
  );
  for (const { record } of facts.reviews) {
    if (
      record.session_id !== facts.session.session_id ||
      record.subject.phase !== "final" ||
      record.subject.candidate_id !== facts.candidate.candidate_id
    )
      reasons.push("EVIDENCE_INVALID");
    if (record.body.verdict === "REJECTED") reasons.push("REVIEW_REJECTED");
    if (
      record.execution_status !== "SUCCEEDED" ||
      record.body.verdict === "INCOMPLETE"
    )
      reasons.push("REVIEW_INCOMPLETE");
    const refs = [
      ...record.body.evidence_refs,
      ...record.body.findings.flatMap((finding) => finding.evidence_refs),
    ];
    if (refs.some((ref) => checks.get(ref.artifact_id) !== ref.digest))
      reasons.push("EVIDENCE_INVALID");
    if (
      record.body.findings.some(
        (finding) =>
          finding.criterion_id !== null &&
          !facts.requirements.criterion_ids.includes(finding.criterion_id),
      )
    )
      reasons.push("EVIDENCE_INVALID");
  }
  return reasons;
}

// Host-only deterministic decision. It never reads a serialized ballot outcome.
export function computeBallot(facts: BallotFacts): Ballot {
  const reasons: BallotReason[] = [
    ...checkReasons(facts),
    ...reviewReasons(facts),
  ];
  if (facts.session.mode !== "enforced") reasons.push("ADVISORY_MODE");
  if (
    !facts.prerequisitesComplete ||
    !["REVIEWING", "APPROVED"].includes(facts.session.state)
  )
    reasons.push("PREREQUISITES_INCOMPLETE");
  const identity = facts.candidate.identity;
  if (
    facts.session.session_id !== identity.session_id ||
    facts.session.current_candidate_id !== facts.candidate.candidate_id ||
    facts.requirements.policy_hash !== identity.policy_hash ||
    facts.session.base_commit.oid !== identity.base_commit.oid ||
    facts.session.base_commit.format !== identity.base_commit.format
  ) {
    reasons.push("EVIDENCE_INVALID");
  }
  const evidence = [
    ...facts.checks.map(({ ref }) => ref),
    ...facts.reviews.flatMap(({ ref, requestRef, invocationRef }) => [
      ref,
      requestRef,
      invocationRef,
    ]),
  ].sort((a, b) =>
    a.artifact_id < b.artifact_id ? -1 : a.artifact_id > b.artifact_id ? 1 : 0,
  );
  if (new Set(evidence.map((ref) => ref.artifact_id)).size !== evidence.length)
    reasons.push("EVIDENCE_INVALID");
  const reasonCodes = [...new Set(reasons)].sort();
  return {
    schema_version: "1.0.0",
    session_id: facts.session.session_id,
    candidate_id: facts.candidate.candidate_id,
    policy_hash: identity.policy_hash,
    evidence,
    reason_codes: reasonCodes,
    quorum_achieved: reasonCodes.length === 0,
  };
}
