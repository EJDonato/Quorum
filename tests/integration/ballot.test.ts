import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateBallot } from "../../src/application/evaluate-ballot.js";
import { failure } from "../../src/contracts/errors.js";
import {
  fakeBallotFixture,
  invocation,
  passingCheck,
  request,
  review,
} from "../fixtures/evidence.js";
import { inputDigest } from "../fixtures/session.js";

await test("host evaluation recomputes ballot from hash-verified synthetic records", async () => {
  const fixture = fakeBallotFixture();
  const result = await evaluateBallot(fixture);
  assert.ok(result.ok);
  assert.equal(result.value.quorum_achieved, true);
  assert.deepEqual(result.value.reason_codes, []);
});
await test("advisory, missing final reviewers and failed checks veto approval", async () => {
  const advisory = fakeBallotFixture();
  advisory.session.mode = "advisory";
  const result = await evaluateBallot(advisory);
  assert.ok(result.ok);
  assert.deepEqual(result.value.reason_codes, ["ADVISORY_MODE"]);
  const missing = fakeBallotFixture();
  missing.evidenceRefs = missing.evidenceRefs.slice(0, 2);
  const missingResult = await evaluateBallot(missing);
  assert.ok(missingResult.ok);
  assert.ok(missingResult.value.reason_codes.includes("SECURITY_MISSING"));
  const failed = fakeBallotFixture();
  const checkRef = failed.put("check", { ...passingCheck(), exit_code: 1 });
  failed.evidenceRefs = [
    { kind: "check", ref: checkRef },
    failed.putReview("qa", review("qa", checkRef)),
    failed.putReview("security", review("security", checkRef)),
  ];
  const failedResult = await evaluateBallot(failed);
  assert.ok(failedResult.ok);
  assert.ok(failedResult.value.reason_codes.includes("CHECK_FAILED"));
});
await test("missing production prerequisite proof blocks perfect synthetic evidence", async () => {
  const fixture = fakeBallotFixture();
  fixture.ports.verifyPrerequisites = () =>
    Promise.resolve(failure("CAPABILITY_MISSING", "No observed enforcement."));
  const result = await evaluateBallot(fixture);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CAPABILITY_MISSING");
});
await test("artifact substitution, unknown authority fields and missing records fail closed", async () => {
  for (const replacement of [
    { ...passingCheck(), exit_code: 1 },
    { ...passingCheck(), quorum_achieved: true },
    undefined,
  ]) {
    const fixture = fakeBallotFixture();
    fixture.artifacts.set("check", replacement);
    assert.equal((await evaluateBallot(fixture)).ok, false);
  }
  const fixture = fakeBallotFixture();
  const unknown = fixture.put("check", {
    ...passingCheck(),
    quorum_achieved: true,
  });
  fixture.evidenceRefs[0] = { kind: "check", ref: unknown };
  assert.equal((await evaluateBallot(fixture)).ok, false);
});
await test("stale candidate and foreign policy, environment or command invalidate ballot", async () => {
  for (const patch of [
    { environment_digest: `sha256:${"f".repeat(64)}` },
    { command_digest: `sha256:${"f".repeat(64)}` },
    { input: { phase: "final", candidate_id: inputDigest } },
  ]) {
    const fixture = fakeBallotFixture();
    const ref = fixture.put("check", { ...passingCheck(), ...patch });
    fixture.evidenceRefs = [
      { kind: "check", ref },
      fixture.putReview("qa", review("qa", ref)),
      fixture.putReview("security", review("security", ref)),
    ];
    const result = await evaluateBallot(fixture);
    assert.ok(result.ok);
    assert.equal(result.value.quorum_achieved, false);
    assert.ok(result.value.reason_codes.includes("EVIDENCE_INVALID"));
  }
  const fixture = fakeBallotFixture();
  fixture.requirements.policy_hash = `sha256:${"f".repeat(64)}`;
  const result = await evaluateBallot(fixture);
  assert.ok(result.ok);
  assert.equal(result.value.quorum_achieved, false);
});
await test("design approval and swapped invocation output never count as final approval", async () => {
  const design = fakeBallotFixture();
  const value = {
    ...review("security", design.checkRef),
    subject: {
      phase: "design",
      role: "security",
      contract_input_digest: inputDigest,
    },
  };
  const ref = design.put("security", value);
  design.evidenceRefs[2] = {
    kind: "review",
    ref,
    request_ref: design.put("request-security", {
      ...request("security"),
      assignment: { phase: "design", role: "security" },
    }),
    invocation_ref: design.put("result-security", invocation("security", ref)),
  };
  assert.equal((await evaluateBallot(design)).ok, false);
  const swapped = fakeBallotFixture();
  const wrong = swapped.put("result-qa", invocation("qa", swapped.checkRef));
  const qa = swapped.evidenceRefs[1];
  assert.ok(qa && qa.kind === "review");
  swapped.evidenceRefs[1] = { ...qa, invocation_ref: wrong };
  assert.equal((await evaluateBallot(swapped)).ok, false);
});
await test("review rejection, incomplete evidence, duplicate reviewers and dangling citations veto", async () => {
  for (const body of [
    {
      verdict: "INCOMPLETE",
      reason: "Missing evidence",
      findings: [],
      evidence_refs: [],
    },
    {
      verdict: "REJECTED",
      findings: [
        {
          criterion_id: "criterion",
          severity: "blocking",
          path: null,
          message: "Broken",
          evidence_refs: [],
        },
      ],
      evidence_refs: [],
    },
    {
      verdict: "APPROVED",
      findings: [],
      evidence_refs: [{ artifact_id: "unknown", digest: inputDigest }],
    },
  ]) {
    const fixture = fakeBallotFixture();
    const raw = { ...review("qa", fixture.checkRef), body };
    const ref = fixture.put("qa", raw);
    fixture.evidenceRefs[1] = {
      kind: "review",
      ref,
      request_ref: fixture.put("request-qa", request("qa")),
      invocation_ref: fixture.put("result-qa", invocation("qa", ref)),
    };
    const result = await evaluateBallot(fixture);
    assert.ok(!result.ok || !result.value.quorum_achieved);
  }
  const fixture = fakeBallotFixture();
  fixture.evidenceRefs.push(fixture.putReview("qa"));
  const result = await evaluateBallot(fixture);
  assert.ok(result.ok);
  assert.ok(result.value.reason_codes.includes("EVIDENCE_INVALID"));
});
await test("valid rejection is a veto and unknown criterion ownership is invalid evidence", async () => {
  for (const criterion of ["criterion", "foreign-criterion"]) {
    const fixture = fakeBallotFixture();
    const value = review("qa", fixture.checkRef);
    value.body = {
      verdict: "REJECTED",
      findings: [
        {
          criterion_id: criterion,
          severity: "blocking",
          path: "src/file.ts",
          message: "Criterion is unmet",
          evidence_refs: [fixture.checkRef],
        },
      ],
      evidence_refs: [fixture.checkRef],
    };
    fixture.evidenceRefs[1] = fixture.putReview("qa", value);
    const result = await evaluateBallot(fixture);
    assert.ok(result.ok);
    assert.ok(result.value.reason_codes.includes("REVIEW_REJECTED"));
    assert.equal(
      result.value.reason_codes.includes("EVIDENCE_INVALID"),
      criterion !== "criterion",
    );
  }
});
await test("review accounting overrun and foreign host requests fail before approval", async () => {
  for (const foreign of [false, true]) {
    const fixture = fakeBallotFixture();
    const qa = fixture.evidenceRefs[1];
    assert.ok(qa?.kind === "review");
    const value = invocation("qa", qa.ref);
    assert.ok(value.usage);
    const replacement = foreign
      ? { ...value, invocation_id: "foreign" }
      : { ...value, usage: { ...value.usage, charged_tokens: 101 } };
    fixture.evidenceRefs[1] = {
      ...qa,
      invocation_ref: fixture.put("result-qa", replacement),
    };
    const result = await evaluateBallot(fixture);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(
        result.error.code,
        foreign ? "EVIDENCE_INVALID" : "BUDGET_EXHAUSTED",
      );
  }
});
