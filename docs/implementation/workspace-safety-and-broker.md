# Milestone 3 — Workspace Safety and the Broker Implementation

## 1. Summary

Milestone 3 establishes the security, isolation, and authorization boundary required before any agent or repository program executes.

This implementation strictly satisfies the invariants from [PRD Section 4](../../PRD.md), [SYSTEM_DESIGN Section 3 and 5](../../SYSTEM_DESIGN.md), and [AGENTS.md](../../AGENTS.md).

---

## 2. Architecture and Modules

### 2.1 Isolated Process Execution

- **Module:** [`src/infrastructure/process/runner.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/process/runner.ts)
- **Functionality:**
  - Spawns subprocesses with explicit argument arrays (`shell: false`).
  - Supports process-group detachment (`detached: true` on POSIX) and recursive process-group termination (`process.kill(-pid, "SIGKILL")`).
  - Enforces timeouts, `AbortSignal` cancellation, and hard stdout/stderr byte limits to prevent unbounded buffering.

### 2.2 Git Isolation and Workspace Management

- **Git Operations:** [`src/infrastructure/git/operations.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/git/operations.ts)
  - `readSourceRepositoryInfo`: Reads canonical repo root, head commit OID, and object format (`sha1` or `sha256`).
  - `checkSourceWorktreeStatus`: Evaluates zero-byte-delimited porcelain status (`git status --porcelain=v1 -z`) to detect pristine vs uncommitted staged, unstaged, and untracked files.
  - `createIsolatedDraft`: Clones repository using `git clone --shared --no-checkout` to share object database without copying files or index; disables hooks via `core.hooksPath=/dev/null`; checks out exact committed `baseSha`.
  - `writeDraftTree`: Stages changes in draft (`git add -A`) and computes Git tree object OID (`git write-tree`).
  - `computeDraftDiff`: Generates cached diff against base commit.
  - Environment sanitization: Runs all Git commands with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, and `GIT_ATTR_NOSYSTEM=1`.
- **Workspace Manager:** [`src/infrastructure/workspace/manager.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/infrastructure/workspace/manager.ts)
  - Creates `.quorum/workspaces/<sessionId>` layout (`draft/`, `meta/`, `artifacts/`).
  - Writes immutable `workspace.json` metadata with session ID, source root, base commit SHA, creation timestamp, and owner PID.
  - `cleanSessionWorkspace`: Fails closed (`LOCKED`) if the session lease is `ACTIVE`. Verifies canonical path containment before safely deleting owned workspace directories.

### 2.3 Tool Contracts and Broker Authorization

- **Contracts:** [`src/contracts/tools.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/contracts/tools.ts)
  - Defines versioned Zod schemas and TypeScript types for all 7 broker tools:
    `repo.read`, `repo.search`, `artifact.read`, `draft.apply_patch`, `checks.run`, `role.submit`, and `scope.request`.
- **Authorizer:** [`src/broker/authorizer.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/broker/authorizer.ts)
  - Enforces role and phase matrix:
    - `PLANNER`: Read-only tools + `scope.request` + `role.submit`. Mutation tools denied.
    - `QA` in `TEST_SPEC`: Can patch test paths and run checks. Cannot touch implementation paths.
    - `DEVELOPER` in `IMPLEMENTING`: Can patch granted implementation paths and run checks. Cannot modify tests, harness configuration, policy, or reserved metadata (`.git`, `.quorum`).
    - `QA` in `REVIEWING`: Strictly read-only! Cannot apply patches or run mutations.
    - `SECURITY` in `DESIGN_REVIEW` or `REVIEWING`: Strictly read-only!
  - `validateSafeRelativePath`: Rejects path traversal (`..`), absolute paths, and reserved metadata escapes.
- **Draft Patch Application:** [`src/broker/patch.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/broker/patch.ts)
  - `computeDraftDigest`: Computes deterministic SHA-256 digest over the Git tree OID (`sha256:${sha256(treeOid)}`).
  - `extractPatchPaths`: Identifies all touched paths from diff headers.
  - Validates every touched path against role grants and protected paths before running any file operations.
  - Compares `expected_draft_digest` with current draft digest; rejects stale requests with `STALE_INPUT`.
  - Runs `git apply --check` and `git apply` using isolated temporary patch files outside the workspace.
- **Tool Broker Entrypoint:** [`src/broker/broker.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/src/broker/broker.ts)
  - Central `executeBrokerTool(context, call)` dispatcher.
  - Binds caller session ID, role, phase, and paths out of band. Agent parameters cannot override authority.
  - Handles `artifact.read`, `role.submit` (persisting immutable results), `scope.request`, and `checks.run`.

---

## 3. Verification and Evidence

- **Unit Tests:**
  - [`tests/unit/authorizer.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/unit/authorizer.test.ts): Role and phase permission gates, path allowlists, protected paths, and path traversal rejection.
  - [`tests/unit/patch.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/unit/patch.test.ts): Patch path extraction for added, modified, and deleted files, and malformed patch rejection.
- **Integration Tests:**
  - [`tests/integration/workspace-isolation.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/integration/workspace-isolation.test.ts):
    1. Repository status detection (pristine vs uncommitted files).
    2. Isolated draft creation from committed base SHA excluding uncommitted files.
    3. Workspace isolation invariant: draft modifications leave source repository, index, and status 100% untouched.
    4. Tree writing and cached diff generation.
    5. Cleanup safety (active session workspace deletion blocked with `LOCKED`).
  - [`tests/integration/broker.test.ts`](file:///Users/eltonjames/Desktop/Personal%20Apps/Quorum/tests/integration/broker.test.ts):
    1. `repo.read` and `repo.search` operating safely on draft files without shell expansion.
    2. `draft.apply_patch` verifying digest freshness, permissions, and protected paths (`SCOPE_DENIED`, `STALE_INPUT`).
    3. Role lifecycle tools (`role.submit`, `scope.request`, `checks.run`, `artifact.read`).
- **Full Quality Suite:** `npm run check` passed completely (formatting, ESLint, TypeScript compiler, size limits, 35 unit tests, 51 integration tests, JSON Schema exports).
