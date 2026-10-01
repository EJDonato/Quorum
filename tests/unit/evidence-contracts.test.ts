import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createCandidateIdentity,
  verifyCandidateIdentity,
} from "../../src/application/candidates.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import {
  invocationRequestSchema,
  invocationResultSchema,
} from "../../src/contracts/invocation.js";
import {
  reviewBodySchema,
  reviewResultSchema,
} from "../../src/contracts/reviews.js";
import { checkPassed, expectedRed } from "../../src/domain/checks.js";
import { validateInvocationResult } from "../../src/domain/invocations.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import {
  candidate,
  identity,
  invocation,
  passingCheck,
  request,
  review,
} from "../fixtures/evidence.js";
import { inputDigest } from "../fixtures/session.js";

const port = { digest: canonicalDigest };
const ref = { artifact_id: "output", digest: inputDigest };
await test("candidate identity changes with each frozen dependency and rejects tampering", () => {
  assert.ok(verifyCandidateIdentity(candidate, port).ok);
  for (const field of [
    "policy_hash",
    "configuration_digest",
    "plan_digest",
    "acceptance_digest",
    "contract_digest",
    "tests_digest",
    "validation_environment_digest",
    "persona_digest",
  ] as const) {
    const result = createCandidateIdentity(
      { ...identity, [field]: `sha256:${"e".repeat(64)}` },
      port,
    );
    assert.ok(result.ok);
    assert.notEqual(result.value.candidate_id, candidate.candidate_id, field);
  }
  for (const changed of [
    { ...identity, tree: { format: "sha1", oid: "e".repeat(40) } },
    { ...identity, adapter: { ...identity.adapter, model_version: "OTHER" } },
  ]) {
    const result = createCandidateIdentity(changed, port);
    assert.ok(result.ok);
    assert.notEqual(result.value.candidate_id, candidate.candidate_id);
  }
  assert.equal(
    verifyCandidateIdentity({ ...candidate, candidate_id: inputDigest }, port)
      .ok,
    false,
  );
  assert.equal(
    createCandidateIdentity({ ...identity, timestamp: "ignored?" }, port).ok,
    false,
  );
  assert.equal(
    createCandidateIdentity(
      { ...identity, tree: { format: "sha256", oid: "e".repeat(64) } },
      port,
    ).ok,
    false,
  );
});
await test("completed process alone cannot pass a check or establish expected red", () => {
  const good = passingCheck();
  assert.equal(checkPassed(good), true);
  for (const patch of [
    { exit_code: 1 },
    { discovered_tests: 0 },
    { report_complete: false },
    { error_count: 1 },
    { execution_status: "TIMED_OUT" as const },
    { failure_class: "infrastructure" as const },
  ]) {
    assert.equal(checkPassed({ ...good, ...patch }), false);
  }
  const red = {
    ...good,
    input: { phase: "expected_red" as const, input_digest: inputDigest },
    exit_code: 1,
    failure_class: "behavioral" as const,
  };
  assert.equal(expectedRed(red), true);
  assert.equal(expectedRed({ ...red, failure_class: "infrastructure" }), false);
  assert.equal(expectedRed({ ...red, kind: "scanner" }), false);
  assert.equal(expectedRed({ ...red, discovered_tests: 0 }), false);
  assert.equal(
    expectedRed({ ...red, kind: "typecheck", failure_class: "compiler" }),
    true,
  );
  const fuzz = {
    ...good,
    kind: "fuzz" as const,
    fuzz: { seed: 1, cases_required: 10, cases_completed: 9 },
  };
  assert.equal(checkPassed(fuzz), false);
  assert.equal(
    checkPassed({ ...fuzz, fuzz: { ...fuzz.fuzz, cases_completed: 10 } }),
    true,
  );
});
await test("invocation binding rejects foreign identity, missing accounting and over-reservation", () => {
  const req = request("qa"),
    result = invocation("qa", ref);
  assert.ok(validateInvocationResult(req, result).ok);
  assert.equal(
    validateInvocationResult(req, {
      ...result,
      input_digest: candidate.candidate_id,
    }).ok,
    false,
  );
  assert.equal(
    invocationResultSchema.safeParse({ ...result, usage: null }).success,
    false,
  );
  assert.ok(result.usage);
  assert.equal(
    validateInvocationResult(req, {
      ...result,
      usage: { ...result.usage, charged_tokens: 101 },
    }).ok,
    false,
  );
  assert.equal(
    invocationRequestSchema.safeParse({
      ...req,
      grants: { ...req.grants, write_paths: ["src"] },
    }).success,
    false,
  );
  assert.equal(
    invocationRequestSchema.safeParse({
      ...req,
      assignment: {
        phase: "final",
        role: "developer",
        candidate_id: candidate.candidate_id,
      },
    }).success,
    false,
  );
  assert.equal(
    invocationResultSchema.safeParse({
      ...result,
      ended_at: "2025-01-01T00:00:00Z",
    }).success,
    false,
  );
});
await test("timestamp comparison handles equivalent fractional representations", () => {
  const times = {
    started_at: "2026-10-01T00:00:00.000Z",
    ended_at: "2026-10-01T00:00:00Z",
  };
  assert.ok(
    checkResultSchema.safeParse({ ...passingCheck(), ...times }).success,
  );
  assert.ok(
    invocationResultSchema.safeParse({ ...invocation("qa", ref), ...times })
      .success,
  );
});
await test("model review body cannot attach authority and interrupted execution cannot approve", () => {
  const good = review("qa", ref);
  assert.ok(reviewResultSchema.safeParse(good).success);
  assert.equal(
    reviewBodySchema.safeParse({
      ...good.body,
      candidate_id: candidate.candidate_id,
    }).success,
    false,
  );
  assert.equal(
    reviewResultSchema.safeParse({ ...good, execution_status: "TIMED_OUT" })
      .success,
    false,
  );
  assert.equal(
    reviewBodySchema.safeParse({
      verdict: "INCOMPLETE",
      findings: [],
      evidence_refs: [],
    }).success,
    false,
  );
  assert.equal(
    reviewBodySchema.safeParse({
      verdict: "REJECTED",
      findings: [],
      evidence_refs: [ref],
    }).success,
    false,
  );
  const findings = [
    {
      criterion_id: null,
      severity: "blocking",
      path: null,
      message: "Unsafe",
      evidence_refs: [ref],
    },
  ];
  assert.equal(
    reviewResultSchema.safeParse({ ...good, body: { ...good.body, findings } })
      .success,
    false,
  );
});
