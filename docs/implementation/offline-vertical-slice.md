# Milestone 4 — Offline Vertical Slice Implementation

## 1. Summary

Milestone 4 connects the deterministic domain core, broker, workspace isolation, candidate freezing, and finalization into a complete offline vertical slice.

Using deterministic fake roles and isolated Git operations, Quorum executes the entire workflow from preflight to completed commit, verifying that:
1. One complete change transitions through `PREFLIGHT` -> `PLANNING` -> `TEST_SPEC` -> `IMPLEMENTING` -> `VALIDATING` -> `REVIEWING` -> `APPROVED` -> `FINALIZING` -> `COMPLETED`.
2. The final commit tree on `refs/heads/quorum/<sessionId>` in the isolated repository exactly equals the approved candidate tree.
3. The user's source repository checkout, git index, and working tree remain completely untouched and pristine.
4. Review rejection routes back to the repair stage (`IMPLEMENTING`) and can recover, or transitions to `BLOCKED` when the repair budget is exhausted.
5. Modifying source repository `HEAD` before finalization triggers `SOURCE_DIVERGED` failure.
6. Finalization recovery recovers the identical receipt and commit OID from stored intent without creating duplicate commit objects.

---

## 2. Architecture and Modules

### 2.1 Candidate Freezing

- **Module:** [`src/application/freeze.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/application/freeze.ts)
- **Functionality:**
  - `freezeCandidate`:
    - Flushes any pending draft changes using `writeDraftTree`.
    - Generates draft unified diff against base commit via `computeDraftDiff`.
    - Computes canonical `CandidateIdentity` and `candidate_id` digest using `createCandidateIdentity`.
    - Writes `manifest.json` and `diff.patch` to the session artifacts directory.
    - Returns frozen candidate manifest and diff string.

### 2.2 Deterministic Finalization

- **Module:** [`src/application/finalize.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/application/finalize.ts)
- **Functionality:**
  - `finalizeSession`:
    - Source divergence check: Compares source repository `headSha` against recorded `baseSha`. If mismatched, fails with `SOURCE_DIVERGED`.
    - Crash recovery check: Reads existing `finalization.json`. If present, verifies `tree_oid` and `base_sha` match, checks existing receipt, and returns recovered receipt without repeating effects.
    - Intent persistence: Writes `finalization.json` artifact before issuing Git mutations.
    - Deterministic commit creation: Uses isolated `git commit-tree` with fixed committer/author timestamps, isolated Git environment (`ISOLATED_ENV`), and explicit parent.
    - Compare-and-swap ref update: Updates `refs/heads/quorum/<sessionId>` using `git update-ref`.
    - Receipt generation: Validates tree and commit OIDs, formats `CommitReceipt`, and persists `receipt.json`.

### 2.3 Fake Roles for Offline Testing

- **Module:** [`src/domain/fake-roles.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/domain/fake-roles.ts)
- **Functionality:**
  - `createFakePlan`: Constructs a valid acyclic `Motion` plan with stable task IDs, criterion IDs, and authorized path grants.
  - `createFakeReviewBody`: Constructs a valid `ReviewBody` (`APPROVED` or `REJECTED`) with structured findings and evidence references.

### 2.4 Orchestration and Session Lifecycle

- **Modules:**
  - [`src/application/session-init.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/application/session-init.ts): Defines `OrchestratorOptions`, `OrchestrationHooks`, `WorkflowContext`, `SessionRunResult`, and `createInitialSessionState`.
  - [`src/application/orchestrator.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/application/orchestrator.ts): Coordinates the end-to-end execution loop:
    - Creates and acquires repository lease (`lease.json`) and command lock (`command.lock`).
    - Creates isolated workspace (`createSessionWorkspace`).
    - Executes state machine transitions using `recordSessionTransition` (backed by append-only `events.jsonl` journal and projection caching).
    - Executes hooks (`onPlan`, `onTestAuthor`, `onImplement`, `onValidate`, `onReview`).
    - Implements repair routing on validation failure or review rejection (`REPAIR_REQUESTED`), looping until approved or budget exhausted (`BLOCKED`).
    - Drives finalization and updates session lease to `COMPLETED` or `BLOCKED`.

---

## 3. Verification and Evidence

### 3.1 Integration Test Suites

- **Offline Vertical Slice:** [`tests/integration/offline-slice.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/integration/offline-slice.test.ts)
  - Full end-to-end execution of a standard change.
  - Verifies `state.state === "COMPLETED"` and `state_sequence === 8`.
  - Verifies private commit object created on `refs/heads/quorum/<sessionId>` in the isolated draft repository.
  - Verifies commit parent equals `headSha` and tree equals receipt tree OID.
  - Verifies source checkout remains strictly pristine (zero unstaged, staged, or untracked modifications).

- **Rejection and Recovery:** [`tests/integration/offline-rejection-recovery.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/integration/offline-rejection-recovery.test.ts)
  - Review rejection triggers repair transition to `IMPLEMENTING`, allows re-implementation, and succeeds on second review.
  - Continuous review rejection exhausts repair budget and transitions session to `BLOCKED`.
  - External modification to source repository `HEAD` during execution blocks finalization with `SOURCE_DIVERGED`.
  - Re-running finalization with existing `finalization.json` recovers the existing receipt and commit OID without duplicating commit objects.

### 3.2 Full Test Suite Results

`npm run check` completed with code 0:
- **Format:** Prettier passed with zero violations.
- **Lint:** ESLint passed with zero warnings or errors.
- **Typecheck:** `tsc --noEmit` passed with zero errors.
- **Size Limits:** All files strictly within physical line limits:
  - `src/application/freeze.ts`: 97 lines (target <= 250)
  - `src/application/finalize.ts`: 155 lines (target <= 250)
  - `src/application/session-init.ts`: 78 lines (target <= 250)
  - `src/application/orchestrator.ts`: 249 lines (target <= 250)
  - `src/domain/fake-roles.ts`: 56 lines (target <= 250)
  - `tests/integration/offline-slice.test.ts`: 121 lines (target <= 350)
  - `tests/integration/offline-rejection-recovery.test.ts`: 199 lines (target <= 350)
- **Unit Tests:** 35 passed, 0 failed.
- **Integration Tests:** 56 passed, 0 failed.
- **JSON Schemas:** Exported schema check passed.

---

## 4. Acceptance Traceability

| PRD Criterion | Status | Evidence |
| :--- | :--- | :--- |
| 1. Approved change & exact commit tree | Complete | `offline-slice.test.ts` asserts private commit tree matches approved candidate |
| 3. Post-approval mutation invalidation | Complete | `offline-rejection-recovery.test.ts` & `ballot.test.ts` verify evidence invalidation |
| 4. Stale/missing evidence rejection | Complete | Schema validation & `finalizeSession` verify evidence references |
| 5. Existing work survives every outcome | Complete | Source repository verified pristine after finalization |
| 7. Crash recovery without duplicate effects | Complete | `finalization.json` intent recovery tested in `offline-rejection-recovery.test.ts` |
| 8. Locking and divergence safety | Complete | Lease acquisition and source divergence checks tested |
| 10. Bounded retries and budgets | Complete | Stage repair counters and budget exhaustion tested |
