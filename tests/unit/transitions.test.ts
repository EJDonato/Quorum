import assert from "node:assert/strict";
import test from "node:test";
import type { TransitionInput } from "../../src/contracts/events.js";
import type { SessionState } from "../../src/contracts/session.js";
import { transition } from "../../src/domain/transitions.js";
import {
  candidateId,
  initialSession,
  inputDigest,
} from "../fixtures/session.js";

function apply(session: SessionState, event: TransitionInput): SessionState {
  const result = transition(session, event);
  assert.equal(result.ok, true);
  return result.value;
}

function reviewing(): SessionState {
  let session = initialSession();
  const events: TransitionInput[] = [
    { type: "PREFLIGHT_COMPLETED" },
    { type: "PLAN_ACCEPTED", design_required: true },
    { type: "DESIGN_CLEARED" },
    { type: "TEST_SPEC_ACCEPTED" },
    { type: "CANDIDATE_FROZEN", candidate_id: candidateId },
    { type: "CHECKS_COMPLETED" },
  ];
  for (const event of events) session = apply(session, event);
  return session;
}

await test("host stage progression freezes a candidate and does not mutate inputs", () => {
  const session = reviewing();
  assert.equal(session.state, "REVIEWING");
  assert.equal(session.state_sequence, 6);
  assert.equal(session.current_candidate_id, candidateId);
  const original = structuredClone(session);
  const changed = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "IMPLEMENTING",
    reason: "Behavior incorrect",
  });
  assert.equal(changed.current_candidate_id, null);
  assert.deepEqual(session, original);
});

await test("out-of-order and forged approval transitions fail", () => {
  for (const event of [
    { type: "CHECKS_COMPLETED" },
    { type: "CANDIDATE_FROZEN", candidate_id: candidateId },
    { type: "APPROVED", quorum_achieved: true },
    { type: "PLAN_ACCEPTED", design_required: false },
    { type: "RESERVE_TOKENS", tokens: 1 },
  ])
    assert.equal(transition(initialSession(), event).ok, false);
  assert.equal(transition(reviewing(), { type: "APPROVED" }).ok, false);
});

await test("per-stage repair counters survive backtracking and block a third repair", () => {
  let session = reviewing();
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "IMPLEMENTING",
    reason: "First failure",
  });
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "PLANNING",
    reason: "Plan defect",
  });
  session = apply(session, { type: "PLAN_ACCEPTED", design_required: false });
  session = apply(session, { type: "TEST_SPEC_ACCEPTED" });
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "IMPLEMENTING",
    reason: "Second failure",
  });
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "IMPLEMENTING",
    reason: "Third failure",
  });
  assert.equal(session.state, "BLOCKED");
  assert.equal(session.budget.repairs_by_stage.IMPLEMENTING, 2);
  assert.equal(session.budget.repairs_total, 3);
});

await test("total repair allowance cannot be reset by moving to a different stage", () => {
  let session = reviewing();
  session.limits.repairs_total = 1;
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "IMPLEMENTING",
    reason: "First failure",
  });
  session = apply(session, {
    type: "REPAIR_REQUESTED",
    stage: "PLANNING",
    reason: "Second failure",
  });
  assert.equal(session.state, "BLOCKED");
  assert.equal(session.budget.repairs_total, 1);
  assert.equal(
    transition(session, {
      type: "RESUME",
      stage: "PLANNING",
      input_digest: inputDigest,
    }).ok,
    false,
  );
});

await test("token ceilings reserve before dispatch and stay charged across cancellation and resume", () => {
  let session = apply(initialSession(), { type: "PREFLIGHT_COMPLETED" });
  session = apply(session, { type: "RESERVE_TOKENS", tokens: 100_000 });
  session = apply(session, { type: "CANCEL", reason: "User cancelled" });
  assert.equal(
    transition(session, { type: "RESERVE_TOKENS", tokens: 1 }).ok,
    false,
  );
  session = apply(session, {
    type: "RESUME",
    stage: "PLANNING",
    input_digest: inputDigest,
  });
  assert.equal(session.budget.tokens_charged, 100_000);
  session = apply(session, { type: "RESERVE_TOKENS", tokens: 100_001 });
  assert.equal(session.state, "BLOCKED");
  assert.equal(session.budget.tokens_charged, 100_000);
});

await test("active deadline blocks at the boundary and malformed accounting is rejected", () => {
  let session = initialSession();
  for (const elapsed_ms of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      transition(session, { type: "CHARGE_ACTIVE_TIME", elapsed_ms }).ok,
      false,
    );
  }
  session = apply(session, {
    type: "CHARGE_ACTIVE_TIME",
    elapsed_ms: 3_600_000,
  });
  assert.equal(session.state, "BLOCKED");
  assert.equal(session.budget.active_elapsed_ms, 3_600_000);
});

await test("resume clears frozen identity, retains counters, and refuses unchecked late-stage restart", () => {
  let session = reviewing();
  session = apply(session, { type: "BLOCK", reason: "Missing evidence" });
  assert.equal(
    transition(session, {
      type: "RESUME",
      stage: "REVIEWING",
      input_digest: inputDigest,
    }).ok,
    false,
  );
  session = apply(session, {
    type: "RESUME",
    stage: "PLANNING",
    input_digest: inputDigest,
  });
  assert.equal(session.current_candidate_id, null);
  assert.equal(session.state, "PLANNING");
});

await test("terminal states reject every event and finalization waits for reconciliation", () => {
  const aborted = apply(initialSession(), { type: "ABORT" });
  for (const event of [
    { type: "ABORT" },
    { type: "CANCEL", reason: "cancel" },
    { type: "PREFLIGHT_COMPLETED" },
  ]) {
    assert.equal(transition(aborted, event).ok, false);
  }
  const session = { ...reviewing(), state: "FINALIZING" };
  assert.equal(transition(session, { type: "ABORT" }).ok, false);
});
