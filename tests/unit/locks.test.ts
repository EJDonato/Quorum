import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireCommandLock,
  acquireSessionLease,
  readLockFile,
  readSessionLease,
  releaseCommandLock,
  releaseSessionLease,
  updateSessionLeaseStatus,
} from "../../src/infrastructure/storage/locks.js";

await test("command lock acquires atomically and releases with matching nonce", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-locks-"));
  const lockPath = join(dir, "lock.json");

  try {
    const acquired = await acquireCommandLock(lockPath, {
      sessionId: "sess_01",
      ttlMs: 5_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    const read = await readLockFile(lockPath);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.session_id, "sess_01");
    assert.equal(read.value.holder_pid, process.pid);

    // Concurrent acquisition while process is alive fails with CONFLICT
    const concurrent = await acquireCommandLock(lockPath, {
      sessionId: "sess_02",
      ttlMs: 5_000,
    });
    assert.equal(concurrent.ok, false);
    if (!concurrent.ok) {
      assert.equal(concurrent.error.code, "LOCKED");
    }

    // Release with wrong nonce fails
    const wrongRelease = await releaseCommandLock(lockPath, "wrong_nonce");
    assert.equal(wrongRelease.ok, false);

    // Release with correct nonce succeeds
    const release = await releaseCommandLock(lockPath, acquired.value.nonce);
    assert.equal(release.ok, true);

    // Now second session can acquire
    const second = await acquireCommandLock(lockPath, {
      sessionId: "sess_02",
      ttlMs: 5_000,
    });
    assert.equal(second.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("session lease prevents two sessions from leasing the same repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-lease-"));
  const leasePath = join(dir, "lease.json");

  try {
    const first = await acquireSessionLease(leasePath, "sess_alpha");
    assert.equal(first.ok, true);

    const second = await acquireSessionLease(leasePath, "sess_beta");
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.error.code, "LOCKED");
    }

    const current = await readSessionLease(leasePath);
    assert.equal(current.ok, true);
    if (!current.ok || current.value === null) return;
    assert.equal(current.value.session_id, "sess_alpha");
    assert.equal(current.value.status, "ACTIVE");

    // Update lease status
    const updated = await updateSessionLeaseStatus(
      leasePath,
      "sess_alpha",
      "BLOCKED",
    );
    assert.equal(updated.ok, true);

    const afterUpdate = await readSessionLease(leasePath);
    assert.equal(afterUpdate.ok, true);
    if (!afterUpdate.ok || afterUpdate.value === null) return;
    assert.equal(afterUpdate.value.status, "BLOCKED");

    // Release lease
    const released = await releaseSessionLease(leasePath, "sess_alpha");
    assert.equal(released.ok, true);

    // Now second session can acquire
    const third = await acquireSessionLease(leasePath, "sess_beta");
    assert.equal(third.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("expired command lock cannot be stolen from a live owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-live-lock-"));
  const path = join(dir, "command.lock");
  try {
    const first = await acquireCommandLock(path, {
      sessionId: "live-session",
      ttlMs: 1,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    assert.ok(first.ok);
    const stolen = await acquireCommandLock(path, {
      sessionId: "other-session",
      now: new Date("2026-10-02T00:00:00Z"),
    });
    assert.ok(!stolen.ok && stolen.error.code === "LOCKED");
    assert.ok((await releaseCommandLock(path, first.value.nonce)).ok);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
