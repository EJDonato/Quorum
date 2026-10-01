# Milestone 2 — Durable Session Control Implementation

## 1. Summary

Milestone 2 establishes reliable session execution state, retry/budget accounting, repository locks/leases, immutable artifact storage, and crash recovery independent of any model or external provider.

The implementation strictly satisfies the requirements from [PRD Section 3 and 4](../../PRD.md), [SYSTEM_DESIGN Section 4](../../SYSTEM_DESIGN.md), and [AGENTS.md](../../AGENTS.md).

---

## 2. Architecture and Modules

### 2.1 Process Liveness Verification

- **Module:** [`src/infrastructure/process/liveness.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/process/liveness.ts)
- **Functionality:** `isProcessAlive(pid: number): boolean` validates process existence using POSIX signal 0 (`process.kill(pid, 0)`). Disallows self, zero, or negative PIDs, catches `ESRCH` (process dead), and verifies permission (`EPERM` indicates process exists).

### 2.2 Storage Locks and Leases

- **Module:** [`src/infrastructure/storage/locks.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/storage/locks.ts)
- **Schemas:**
  - `lockSchema`: Opaque session ID, holder PID, unique nonce, creation timestamp, UTC expiration timestamp.
  - `leaseSchema`: Repository-level session lease with session ID, acquisition time, and status (`ACTIVE`, `BLOCKED`, `CANCELLED`, `COMPLETED`, `ABORTED`).
- **Invariants:**
  - Uses `O_CREAT | O_EXCL` (`wx` mode) with `0o600` permissions.
  - Parent directory is explicitly flushed via `dirHandle.sync()`.
  - Atomic acquisition: If lock exists, inspects holder PID liveness and expiration. Only reclaims if the holding process is dead or expired.
  - Release requires matching nonce to prevent accidental release of locks acquired by another process.
  - Session lease enforces single active session per repository workspace.

### 2.3 Immutable Artifact Store

- **Module:** [`src/infrastructure/storage/artifacts.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/storage/artifacts.ts)
- **Functionality:**
  - `writeArtifact(artifactsDir, relativePath, content)`: Rejects path traversal and absolute path escapes (`validateSafeRelativePath`). Writes to a temporary file in the target directory, syncs to disk (`handle.sync()`), renames atomically to target path, syncs directory, and applies read-only permissions (`0o444`). Computes canonical SHA-256 digest (`sha256:...`).
  - `readArtifact(artifactsDir, relativePath, expectedDigest)`: Reads file, verifies digest matches `expectedDigest`, and fails closed with `EVIDENCE_INVALID` if content diverges.

### 2.4 Durable Append-Only Event Journal

- **Module:** [`src/infrastructure/storage/journal.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/storage/journal.ts)
- **Functionality:**
  - `appendJournalEvent(sessionDir, event)`: Appends single-line JSON event to `events.jsonl`, invokes `handle.sync()`, and flushes parent directory.
  - `readJournalEvents(sessionDir)`: Parses contiguous sequence numbers. Trailing incomplete lines (e.g. from an abrupt crash during write) are truncated and recovered up to the last valid record. Any corrupted, out-of-order, or invalid internal records cause immediate fail-closed error (`EVIDENCE_INVALID`).
  - `saveStateProjection` and `readStateProjection`: Manages rebuildable `state.json` cache atomically.
  - `rebuildSessionState`: Reconstructs complete session state from scratch by replaying the event journal through `replaySessionEvents`.

### 2.5 Application Session Control

- **Module:** [`src/application/session-control.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/application/session-control.ts)
- **Functionality:**
  - `loadOrReconstructState`: Inspects cached projection; if missing or stale, rebuilds state deterministically from journal events.
  - `recordSessionTransition`: Evaluates state reducer transition, validates event chaining and previous digest, appends journal event, flushes disk, and updates projection cache.
  - `cancelSession`: Records `CANCEL` event, transitioning state to `CANCELLED` and retaining workspace.
  - `abortSession`: Records `ABORT` event, transitioning to terminal `ABORTED` state.
  - `resumeSession`: Verifies preconditions and input digest, restarting the earliest affected stage.

---

## 3. Verification and Evidence

- **Unit Tests:**
  - [`tests/unit/locks.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/unit/locks.test.ts): Atomic acquisition, nonce validation on release, stale lock recovery, and lease mutual exclusion.
  - [`tests/unit/artifacts.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/unit/artifacts.test.ts): Read-only permission mode, directory syncing, path traversal rejection, SHA-256 digest computation and mismatch verification.
- **Integration Tests:**
  - [`tests/integration/durable-session.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/integration/durable-session.test.ts):
    1. Contiguous event appending and projection cache updates.
    2. Complete projection loss reconstruction from raw event journal.
    3. Trailing crash truncation recovery.
    4. Internal journal line corruption failing closed.
    5. Full lifecycle transitions (`CANCEL`, `RESUME`, `ABORT`) with durable state preservation.
- **Complexity and Size:** All production modules strictly satisfy `AGENTS.md` (each `<= 250` physical lines, max depth `<= 3`, functions `<= 40` lines).
