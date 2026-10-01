import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  abortSession,
  cancelSession,
  loadOrReconstructState,
  recordSessionTransition,
  resumeSession,
} from "../../src/application/session-control.js";
import {
  readJournalEvents,
  readStateProjection,
} from "../../src/infrastructure/storage/journal.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import {
  candidateId,
  initialSession,
  inputDigest,
} from "../fixtures/session.js";

const ports = { digest: canonicalDigest };

await test("durable journal appends contiguous events and updates projection cache", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-journal-"));
  const initial = initialSession();

  try {
    // PREFLIGHT_COMPLETED
    const step1 = await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });
    assert.equal(step1.ok, true);
    if (!step1.ok) return;
    assert.equal(step1.value.state, "PLANNING");
    assert.equal(step1.value.state_sequence, 1);

    // PLAN_ACCEPTED
    const step2 = await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PLAN_ACCEPTED", design_required: false },
      ports,
    });
    assert.equal(step2.ok, true);
    if (!step2.ok) return;
    assert.equal(step2.value.state, "TEST_SPEC");
    assert.equal(step2.value.state_sequence, 2);

    // TEST_SPEC_ACCEPTED
    const step3 = await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "TEST_SPEC_ACCEPTED" },
      ports,
    });
    assert.equal(step3.ok, true);
    if (!step3.ok) return;
    assert.equal(step3.value.state, "IMPLEMENTING");
    assert.equal(step3.value.state_sequence, 3);

    // CANDIDATE_FROZEN
    const step4 = await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "CANDIDATE_FROZEN", candidate_id: candidateId },
      ports,
    });
    assert.equal(step4.ok, true);
    if (!step4.ok) return;
    assert.equal(step4.value.state, "VALIDATING");
    assert.equal(step4.value.state_sequence, 4);

    // Inspect events.jsonl
    const events = await readJournalEvents(dir);
    assert.equal(events.ok, true);
    if (!events.ok) return;
    assert.equal(events.value.length, 4);
    assert.equal(events.value[0]?.sequence, 1);
    assert.equal(events.value[0]?.previous_digest, null);
    assert.equal(events.value[1]?.sequence, 2);
    assert.notEqual(events.value[1]?.previous_digest, null);

    // Inspect state.json projection
    const projection = await readStateProjection(dir);
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value === null) return;
    assert.equal(projection.value.state, "VALIDATING");
    assert.equal(projection.value.state_sequence, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("projection loss reconstructs state cleanly from durable event journal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-recovery-"));
  const initial = initialSession();

  try {
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PLAN_ACCEPTED", design_required: false },
      ports,
    });

    // Delete state.json cache to simulate disk loss
    await unlink(join(dir, "state.json"));
    const deletedCheck = await readStateProjection(dir);
    assert.equal(deletedCheck.ok, true);
    assert.equal(deletedCheck.value, null);

    // Load or reconstruct state
    const reconstructed = await loadOrReconstructState({
      sessionDir: dir,
      initial,
      ports,
    });
    assert.equal(reconstructed.ok, true);
    if (!reconstructed.ok) return;
    assert.equal(reconstructed.value.state, "TEST_SPEC");
    assert.equal(reconstructed.value.state_sequence, 2);

    // Reconstruct re-created state.json
    const reCreated = await readStateProjection(dir);
    assert.equal(reCreated.ok, true);
    assert.notEqual(reCreated.value, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("trailing truncated event write is recovered up to last valid record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-crash-"));
  const initial = initialSession();

  try {
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });
    // Append partial unclosed JSON
    await appendFile(
      join(dir, "events.jsonl"),
      '{"schema_version": "1.0.0", "event_id": "truncated_write...',
      "utf8",
    );

    const recovered = await readJournalEvents(dir);
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.value.length, 1);
    assert.equal(recovered.value[0]?.sequence, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("corrupted internal journal line fails closed with EVIDENCE_INVALID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-corrupt-"));
  const initial = initialSession();

  try {
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PLAN_ACCEPTED", design_required: false },
      ports,
    });

    const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).split(
      "\n",
    );
    lines[0] = '{"corrupted": true}';
    await writeFile(join(dir, "events.jsonl"), lines.join("\n"), "utf8");

    const events = await readJournalEvents(dir);
    assert.equal(events.ok, false);
    if (!events.ok) {
      assert.equal(events.error.code, "EVIDENCE_INVALID");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("cancel, resume, and abort lifecycle transitions update durable state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-lifecycle-"));
  const initial = initialSession();

  try {
    await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });

    // CANCEL
    const cancelled = await cancelSession({
      sessionDir: dir,
      initial,
      reason: "User requested pause",
      ports,
    });
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.value.state, "CANCELLED");

    // RESUME back to PLANNING
    const resumed = await resumeSession({
      sessionDir: dir,
      initial,
      stage: "PLANNING",
      inputDigest,
      ports,
    });
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    assert.equal(resumed.value.state, "PLANNING");

    // ABORT
    const aborted = await abortSession({
      sessionDir: dir,
      initial,
      ports,
    });
    assert.equal(aborted.ok, true);
    if (!aborted.ok) return;
    assert.equal(aborted.value.state, "ABORTED");

    // Further transitions in ABORTED state fail
    const forbidden = await recordSessionTransition({
      sessionDir: dir,
      initial,
      payload: { type: "PREFLIGHT_COMPLETED" },
      ports,
    });
    assert.equal(forbidden.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
