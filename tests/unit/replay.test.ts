import assert from "node:assert/strict";
import test from "node:test";
import { replay } from "../../src/application/replay.js";
import type {
  SessionEvent,
  TransitionInput,
} from "../../src/contracts/events.js";
import { transition } from "../../src/domain/transitions.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { initialSession } from "../fixtures/session.js";

function journal(payloads: TransitionInput[]): SessionEvent[] {
  const events: SessionEvent[] = [];
  let previous_digest: string | null = null;
  for (const payload of payloads) {
    const event: SessionEvent = {
      schema_version: "1.0.0",
      event_id: `event-${events.length + 1}`,
      session_id: initialSession().session_id,
      sequence: events.length + 1,
      previous_digest,
      timestamp: "2026-10-01T00:00:00Z",
      payload,
    };
    const hash = canonicalDigest(event);
    assert.equal(hash.ok, true);
    previous_digest = hash.value;
    events.push(event);
  }
  return events;
}

const ports = { digest: canonicalDigest };

await test("discarding a projection and replaying recorded events reconstructs state and charged budgets", () => {
  const events = journal([
    { type: "PREFLIGHT_COMPLETED" },
    { type: "RESERVE_TOKENS", tokens: 10_000 },
    { type: "REPAIR_REQUESTED", stage: "PLANNING", reason: "Malformed plan" },
    { type: "BLOCK", reason: "Interrupted invocation; usage unknown" },
  ]);
  let expected = initialSession();
  for (const event of events) {
    const result = transition(expected, event.payload);
    assert.equal(result.ok, true);
    expected = result.value;
  }
  const serialized: unknown = JSON.parse(JSON.stringify(events));
  assert.ok(Array.isArray(serialized));
  const reconstructed = replay({
    initial: initialSession(),
    events: serialized,
    ports,
  });
  assert.deepEqual(reconstructed, { ok: true, value: expected });
  assert.equal(expected.budget.tokens_charged, 10_000);
  assert.equal(expected.budget.repairs_by_stage.PLANNING, 1);
});

await test("corrupt, missing, reordered, foreign, duplicate, or unknown-version records fail closed", () => {
  const events = journal([
    { type: "PREFLIGHT_COMPLETED" },
    { type: "PLAN_ACCEPTED", design_required: true },
  ]);
  const first = events[0];
  const second = events[1];
  assert.ok(first && second);
  for (const invalid of [
    [second],
    [second, first],
    [first, first],
    [first, { ...second, previous_digest: `sha256:${"f".repeat(64)}` }],
    [first, { ...second, session_id: "other-session" }],
    [first, { ...second, schema_version: "2.0.0" }],
    [first, { ...second, event_id: first.event_id }],
    [first, { ...second, payload: { type: "CANDIDATE_FROZEN" } }],
    [
      { ...first, payload: { type: "PREFLIGHT_COMPLETED", extra: true } },
      second,
    ],
  ])
    assert.equal(
      replay({ initial: initialSession(), events: invalid, ports }).ok,
      false,
    );
});

await test("a valid-looking but forbidden state transition does not become valid on replay", () => {
  const events = journal([{ type: "CHECKS_COMPLETED" }]);
  assert.equal(replay({ initial: initialSession(), events, ports }).ok, false);
  assert.equal(
    replay({
      initial: { ...initialSession(), state_sequence: 1 },
      events: [],
      ports,
    }).ok,
    false,
  );
});
