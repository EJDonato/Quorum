// Synthetic host evidence only: no runner, isolation, or production capability proof.
import { strict as assert } from "node:assert";
import { createCandidateIdentity } from "../../src/application/candidates.js";
import type { BallotPorts } from "../../src/application/evaluate-ballot.js";
import type { CandidateIdentity } from "../../src/contracts/candidate.js";
import type { CheckResult } from "../../src/contracts/checks.js";
import type {
  InvocationRequest,
  InvocationResult,
} from "../../src/contracts/invocation.js";
import type { ReviewResult } from "../../src/contracts/reviews.js";
import type { ArtifactReference } from "../../src/contracts/ballot-input.js";
import { failure } from "../../src/contracts/errors.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { initialSession, inputDigest } from "./session.js";

export const timestamp = "2026-10-01T00:00:00Z";
export const identity: CandidateIdentity = {
  schema_version: "1.0.0",
  session_id: "session-fixture",
  base_commit: { format: "sha1", oid: "c".repeat(40) },
  tree: { format: "sha1", oid: "d".repeat(40) },
  policy_hash: inputDigest,
  configuration_digest: inputDigest,
  plan_digest: inputDigest,
  acceptance_digest: inputDigest,
  contract_digest: inputDigest,
  tests_digest: inputDigest,
  validation_environment_digest: inputDigest,
  persona_digest: inputDigest,
  adapter: {
    name: "codex",
    version: "FAKE",
    model: "FAKE",
    model_version: "FAKE",
  },
};
const created = createCandidateIdentity(identity, { digest: canonicalDigest });
assert.ok(created.ok);
export const candidate = created.value;

export function passingCheck(): CheckResult {
  return {
    schema_version: "1.0.0",
    check_result_id: "check-result",
    session_id: identity.session_id,
    check_id: "test",
    input: { phase: "final", candidate_id: candidate.candidate_id },
    kind: "test",
    execution_status: "SUCCEEDED",
    exit_code: 0,
    duration_ms: 0,
    started_at: timestamp,
    ended_at: timestamp,
    command_digest: inputDigest,
    environment_digest: inputDigest,
    tool_version: "FAKE",
    stdout_ref: { artifact_id: "stdout", digest: inputDigest },
    stderr_ref: { artifact_id: "stderr", digest: inputDigest },
    report_complete: true,
    discovered_tests: 1,
    error_count: 0,
    warning_count: 0,
    failure_class: null,
    fuzz: null,
  };
}

export function request(role: "qa" | "security"): InvocationRequest {
  return {
    protocol_version: "1.0.0",
    invocation_id: `invocation-${role}`,
    session_id: identity.session_id,
    task_id: null,
    assignment: { phase: "final", role, candidate_id: candidate.candidate_id },
    input_digest: inputDigest,
    input_refs: [{ artifact_id: "candidate", digest: candidate.candidate_id }],
    grants: {
      tools: ["repo.read", "artifact.read", "role.submit"],
      read_paths: ["src"],
      write_paths: [],
      check_ids: [],
    },
    response_schema_ref: { artifact_id: "schema", digest: inputDigest },
    limits: { timeout_ms: 1000, tokens_reserved: 100 },
  };
}

export function invocation(
  role: "qa" | "security",
  output: ArtifactReference,
): InvocationResult {
  return {
    protocol_version: "1.0.0",
    invocation_id: `invocation-${role}`,
    session_id: identity.session_id,
    input_digest: inputDigest,
    execution_status: "SUCCEEDED",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      charged_tokens: 15,
      accounting_complete: true,
    },
    output_ref: output,
    error: null,
    started_at: timestamp,
    ended_at: timestamp,
  };
}

export function review(
  role: "qa" | "security",
  evidence: ArtifactReference,
): ReviewResult {
  return {
    schema_version: "1.0.0",
    session_id: identity.session_id,
    invocation_id: `invocation-${role}`,
    input_digest: inputDigest,
    subject: { phase: "final", role, candidate_id: candidate.candidate_id },
    execution_status: "SUCCEEDED",
    submitted_at: timestamp,
    body: { verdict: "APPROVED", findings: [], evidence_refs: [evidence] },
  };
}

export function fakeBallotFixture() {
  const artifacts = new Map<string, unknown>();
  function put(id: string, value: unknown): ArtifactReference {
    const hashed = canonicalDigest(value);
    assert.ok(hashed.ok);
    artifacts.set(id, value);
    return { artifact_id: id, digest: hashed.value };
  }
  const checkRef = put("check", passingCheck());
  function putReview(role: "qa" | "security", value = review(role, checkRef)) {
    const ref = put(role, value);
    return {
      kind: "review" as const,
      ref,
      request_ref: put(`request-${role}`, request(role)),
      invocation_ref: put(`result-${role}`, invocation(role, ref)),
    };
  }
  const ports: BallotPorts = {
    digest: canonicalDigest,
    readArtifact: (ref) =>
      Promise.resolve(
        artifacts.has(ref.artifact_id)
          ? { ok: true as const, value: artifacts.get(ref.artifact_id) }
          : failure("EVIDENCE_INVALID", "Missing synthetic artifact."),
      ),
    verifyPrerequisites: () => Promise.resolve({ ok: true, value: undefined }),
  };
  return {
    artifacts,
    put,
    putReview,
    ports,
    checkRef,
    session: {
      ...initialSession(),
      state: "REVIEWING",
      current_candidate_id: candidate.candidate_id,
    },
    candidate,
    requirements: {
      schema_version: "1.0.0",
      policy_hash: inputDigest,
      criterion_ids: ["criterion"],
      required_checks: [
        { check_id: "test", kind: "test", command_digest: inputDigest },
      ],
    },
    evidenceRefs: [
      { kind: "check" as const, ref: checkRef },
      putReview("qa"),
      putReview("security"),
    ],
  };
}
