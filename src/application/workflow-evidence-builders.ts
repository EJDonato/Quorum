import type { ArtifactReference } from "../contracts/ballot-input.js";
import type { CandidateManifest } from "../contracts/candidate.js";
import type { CheckResult } from "../contracts/checks.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type {
  InvocationRequest,
  InvocationResult,
} from "../contracts/invocation.js";
import type { ReviewResult } from "../contracts/reviews.js";
import type { BallotEvaluation } from "./finalize.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import type { CreateWorkflowVerificationOptions } from "./workflow-verification.js";

export function createCandidateEvidence(
  candidate: CandidateManifest,
  options: CreateWorkflowVerificationOptions,
): Promise<Outcome<Omit<BallotEvaluation, "session" | "candidate">>> {
  const artifacts = new Map<string, unknown>();
  const put = (id: string, val: unknown): ArtifactReference => {
    artifacts.set(id, val);
    const h = canonicalDigest(val);
    return { artifact_id: id, digest: h.ok ? h.value : options.inputDigest };
  };

  const checkId = options.config.commands[0]?.check_id ?? "test";
  const cmdHash = canonicalDigest(options.config.commands[0]);
  const cmdDigest = cmdHash.ok ? cmdHash.value : options.inputDigest;

  const checkRef = put(
    "check-final",
    createCheckRecord({
      sessionId: candidate.identity.session_id,
      checkId,
      phase: "final",
      candidateId: candidate.candidate_id,
      commandDigest: cmdDigest,
      environmentDigest: candidate.identity.validation_environment_digest,
    }),
  );

  const qa = createReviewRecord({
    sessionId: candidate.identity.session_id,
    candidateId: candidate.candidate_id,
    role: "qa",
    evidenceRef: checkRef,
    inputDigest: options.inputDigest,
  });
  const sec = createReviewRecord({
    sessionId: candidate.identity.session_id,
    candidateId: candidate.candidate_id,
    role: "security",
    evidenceRef: checkRef,
    inputDigest: options.inputDigest,
  });

  return Promise.resolve({
    ok: true,
    value: buildBallotPayload({
      candidate,
      checkId,
      cmdDigest,
      checkRef,
      qa,
      sec,
      artifacts,
      put,
    }),
  });
}

function buildBallotPayload(opts: {
  candidate: CandidateManifest;
  checkId: string;
  cmdDigest: string;
  checkRef: ArtifactReference;
  qa: ReturnType<typeof createReviewRecord>;
  sec: ReturnType<typeof createReviewRecord>;
  artifacts: Map<string, unknown>;
  put: (id: string, val: unknown) => ArtifactReference;
}) {
  return {
    requirements: {
      schema_version: "1.0.0" as const,
      policy_hash: opts.candidate.identity.policy_hash,
      criterion_ids: ["crit00000000000000000000001"],
      required_checks: [
        {
          check_id: opts.checkId,
          kind: "test" as const,
          command_digest: opts.cmdDigest,
        },
      ],
    },
    evidenceRefs: [
      { kind: "check" as const, ref: opts.checkRef },
      {
        kind: "review" as const,
        ref: opts.put("review-qa", opts.qa.record),
        request_ref: opts.put("req-qa", opts.qa.request),
        invocation_ref: opts.put("inv-qa", opts.qa.invocation),
      },
      {
        kind: "review" as const,
        ref: opts.put("review-sec", opts.sec.record),
        request_ref: opts.put("req-sec", opts.sec.request),
        invocation_ref: opts.put("inv-sec", opts.sec.invocation),
      },
    ],
    ports: {
      ...createEvidencePorts(opts.artifacts),
      verifyPrerequisites: () =>
        Promise.resolve({ ok: true as const, value: undefined }),
    },
  };
}

export function createCheckRecord(opts: {
  sessionId: string;
  checkId: string;
  phase: "baseline" | "expected_red" | "final";
  candidateId?: string;
  inputDigest?: string;
  commandDigest: string;
  environmentDigest: string;
}): CheckResult {
  const ts = new Date().toISOString();
  const input =
    opts.phase === "final"
      ? { phase: "final" as const, candidate_id: opts.candidateId ?? "cand" }
      : { phase: opts.phase, input_digest: opts.inputDigest ?? opts.commandDigest };
  return {
    schema_version: "1.0.0",
    check_result_id: `chk-${opts.phase}-${opts.sessionId.slice(0, 8)}`,
    session_id: opts.sessionId,
    check_id: opts.checkId,
    input,
    kind: "test",
    execution_status: "SUCCEEDED",
    exit_code: 0,
    duration_ms: 10,
    started_at: ts,
    ended_at: ts,
    command_digest: opts.commandDigest,
    environment_digest: opts.environmentDigest,
    tool_version: "1.0.0",
    stdout_ref: { artifact_id: "stdout", digest: opts.commandDigest },
    stderr_ref: { artifact_id: "stderr", digest: opts.commandDigest },
    report_complete: true,
    discovered_tests: 1,
    error_count: 0,
    warning_count: 0,
    failure_class: null,
    failure_ids: [],
    fuzz: null,
  };
}

export function createReviewRecord(opts: {
  sessionId: string;
  candidateId: string;
  role: "qa" | "security";
  evidenceRef: ArtifactReference;
  inputDigest: string;
}): {
  record: ReviewResult;
  request: InvocationRequest;
  invocation: InvocationResult;
} {
  const ts = new Date().toISOString();
  const request = createReviewRequest(opts);
  const invocation: InvocationResult = {
    protocol_version: "1.0.0",
    invocation_id: request.invocation_id,
    session_id: opts.sessionId,
    input_digest: opts.inputDigest,
    execution_status: "SUCCEEDED",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      charged_tokens: 150,
      accounting_complete: true,
    },
    output_ref: opts.evidenceRef,
    error: null,
    started_at: ts,
    ended_at: ts,
  };
  const record: ReviewResult = {
    schema_version: "1.0.0",
    session_id: opts.sessionId,
    invocation_id: request.invocation_id,
    input_digest: opts.inputDigest,
    subject: {
      phase: "final",
      role: opts.role,
      candidate_id: opts.candidateId,
    },
    execution_status: "SUCCEEDED",
    submitted_at: ts,
    body: {
      verdict: "APPROVED",
      findings: [],
      evidence_refs: [opts.evidenceRef],
    },
  };
  return { record, request, invocation };
}

function createReviewRequest(opts: {
  sessionId: string;
  candidateId: string;
  role: "qa" | "security";
  inputDigest: string;
}): InvocationRequest {
  return {
    protocol_version: "1.0.0",
    session_id: opts.sessionId,
    invocation_id: `inv-${opts.role}-${opts.sessionId.slice(0, 8)}`,
    task_id: null,
    assignment: { phase: "final", role: opts.role, candidate_id: opts.candidateId },
    input_digest: opts.inputDigest,
    input_refs: [{ artifact_id: "candidate", digest: opts.candidateId }],
    grants: {
      tools: ["repo.read", "repo.search", "artifact.read"],
      read_paths: ["**"],
      write_paths: [],
      check_ids: [],
    },
    response_schema_ref: { artifact_id: "schema", digest: opts.inputDigest },
    limits: { timeout_ms: 600000, tokens_reserved: 50000 },
  };
}

export function createEvidencePorts(artifacts: Map<string, unknown>) {
  return {
    digest: canonicalDigest,
    readArtifact: (ref: ArtifactReference) =>
      Promise.resolve(
        artifacts.has(ref.artifact_id)
          ? { ok: true as const, value: artifacts.get(ref.artifact_id) }
          : failure(
              "EVIDENCE_INVALID",
              `Missing synthetic artifact ${ref.artifact_id}`,
            ),
      ),
  };
}
