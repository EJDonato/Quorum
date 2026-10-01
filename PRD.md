# Product Requirements Document: Quorum

**Identity:** Multi-agent coding workflow with verifiable approval gates  
**Status:** Implementation specification; release requires the acceptance criteria below  
**Version:** 2.1.0  
**Initial scope:** Local Git repositories containing TypeScript/Node.js projects; one runner adapter  
**Portability:** Adapter-based roadmap, not a universal compatibility claim

## 1. Purpose and Product Boundary

Quorum turns a bounded development request into an isolated candidate change, checks it, obtains independent QA and security verdicts, and optionally creates one local commit containing the approved result.

The primary user is a developer working in an existing repository who wants an auditable review process without manually coordinating multiple agents. Success means producing useful changes while preserving the user's work and preventing Quorum from finalizing unreviewed changes.

### 1.1 Core guarantees

- **Quorum-controlled commits require approval.** Only the trusted orchestrator can finalize a session, and only the exact approved candidate can be committed.
- **Approval is revision-specific.** QA and security must independently approve the final candidate; a design review is never a substitute for implementation review.
- **Existing work is preserved.** Session execution and abort never reset, clean, stage, or overwrite the user's original checkout.
- **Evidence is explicit.** Structured artifacts identify what was checked, by which tools, under which policy, and with what result. Artifacts reduce conversational context; they do not guarantee correctness or eliminate hallucination.
- **Enforcement is capability-dependent.** Enforced mode requires operating-system isolation and a trusted tool broker. Prompt instructions alone are advisory.

These guarantees apply to Quorum's own operations. MVP does not prevent a human or another application from committing outside Quorum, and does not enforce protected-branch merges. Remote push, PR merge, deployment, history rewriting, and production access are out of scope. A verified result is evidence of the configured checks, not proof that software is defect-free.

### 1.2 MVP and non-goals

MVP supports one local session at a time per repository, serial tasks, one final commit, and a TypeScript/Node.js project with a lockfile and configured validation commands. The first planned agent adapter is Claude Code, running inside Quorum's isolation boundary. Its exact supported version and invocation must be established by a compatibility spike and pinned in a tested release manifest before implementation acceptance; examples here specify Quorum commands, not third-party CLI syntax.

Initial enforced execution uses Linux containers; macOS may host those containers through a compatible container runtime. Windows-native execution, additional language stacks, parallel implementation branches, distributed councils, automatic package installation, arbitrary network-dependent integration tests, and automatic merges are deferred. Missing isolation or adapter capabilities block enforced runs.

The orchestrator and CLI will be implemented in TypeScript and distributed as a versioned npm package. Installation instructions must state supported Node.js, Git, container runtime, and runner versions from the release manifest.

## 2. Simplified Workflow

Nine specialties do not require nine agents on every change. MVP uses four required agent responsibilities: planning, implementation, QA, and security. Validation and Git finalization are deterministic orchestrator operations.

```text
Preflight and isolated workspace
             |
Plan, risk classification, and acceptance criteria
             |
[Contract design + security design gate, when required]
             |
QA test specification and baseline evidence
             |
Implementation <---- bounded repair loop
             |
[Optional scoped refactoring]
             |
Freeze candidate revision
             |
Automated tests, lint/type checks, and required extra checks
             |
Final QA verdict + final security verdict
             |
Orchestrator evaluates ballot
             |
APPROVED: inspect/export, or explicitly requested local commit
```

Check failures return to the appropriate owner within the shared repair budget. No mutation is permitted while a candidate is under final validation. Every repair produces a new candidate and invalidates prior final approvals.

### 2.1 Required versus conditional responsibilities

| Responsibility | Default behavior | Authority and boundary |
| :--- | :--- | :--- |
| `/plan` | Required; emits task sequence, acceptance criteria, scope, and risk classification | Reads repository; writes only its result through the broker |
| `/dev` | Required for implementation changes | Writes only task-authorized implementation paths; cannot edit policy, evidence, tests, Git metadata, or review results |
| `/qa` | Required before implementation and for final acceptance | Authors/revises tests through the broker; cannot modify production code; final approval requires executable evidence or an explicit allowed exception |
| `/sec` | Required final implementation review; also reviews sensitive designs before implementation | Read-only candidate access and approved scanner tools; cannot modify code or its own recorded evidence |
| `/arch` | Conditional when changing public contracts, authentication/authorization, persistence, payments, or external interfaces | Produces contract artifacts; implementation changes remain with `/dev` |
| `/refactor` | Optional, explicitly scoped task or planned step | Same protected paths as `/dev`; requires behavior-preservation evidence and complete final revalidation |
| `/lint` | Automated configured checks, not a separate required agent | No autofix during validation; reports diagnostics and exit codes |
| `/chaos` | Deferred specialist; conditional bounded fuzz/fault tests can use configured tools | Isolated fixtures only; never production or live services |
| `/git` | Deterministic finalization, not an autonomous agent | Requires a current approved ballot; commits only the session candidate |

A small behavior change normally needs no architecture agent, refactoring pass, or chaos agent. Linting and type checking are required when applicable to the repository and changed files; they do not need a model call. Boundary cases belong in ordinary QA even when chaos testing is absent.

### 2.2 Risk and additional gates

The planner proposes a classification; the orchestrator combines it with configured sensitive-path rules. Agents cannot lower required gates. New sensitive files or dependencies discovered later escalate the classification and return the session to design review where necessary.

- **Standard code change:** Final QA/security approval, regression tests, applicable lint/type checks.
- **Sensitive change:** Contract/design review and security design approval, relevant boundary tests, plus all final gates. Sensitive areas include credentials, authorization, persistence/migrations, payments, external input processing, and dependency changes.
- **Documentation-only change:** QA may waive red/green execution only when the diff contains exclusively configured non-executable documentation paths. Documentation checks still run, and final QA/security verdicts remain required.
- **Fuzz-required change:** Repository policy may require bounded fuzz tests for parsers, deserializers, or exposed input handlers. If required tooling is unavailable, block; do not silently skip it.

Unsupported migrations, environments, or test infrastructure produce a blocked result with a reason. There is no agent-controlled gate bypass. Policy changes create a new policy revision and invalidate approvals; mandatory core gates cannot be disabled in enforced mode.

## 3. Session State and Recovery

The orchestrator owns state. Agents return proposed results; they cannot advance stages themselves.

| State | Successful transition | Failure or mutation behavior |
| :--- | :--- | :--- |
| `PREFLIGHT` | `PLANNING` after capabilities, isolation, base, and commands are recorded | `BLOCKED` on missing prerequisites |
| `PLANNING` | `DESIGN_REVIEW` if required, otherwise `TEST_SPEC` | Invalid plan is retried within budget, then `BLOCKED` |
| `DESIGN_REVIEW` | `TEST_SPEC` after security design approval | Return to planning/architecture with rationale within budget |
| `TEST_SPEC` | `IMPLEMENTING` after baseline and expected-failure evidence, or documented exception | Infrastructure/baseline failures block; invalid test specification returns to QA |
| `IMPLEMENTING` | `VALIDATING` after tasks and optional refactoring finish and candidate is frozen | Test failures return to Dev; test-specification defects return to QA |
| `VALIDATING` | `REVIEWING` after all required checks pass | Repairable failures return to implementation; infrastructure failures block |
| `REVIEWING` | `APPROVED` only after both final approvals and ballot evaluation | Rejection routes to design, QA, or Dev with rationale within budget |
| `APPROVED` | `FINALIZING` on explicit commit request | Any relevant input change invalidates approval |
| `FINALIZING` | `COMPLETED` after commit tree and receipt are verified | Failure blocks with recoverable transaction evidence |
| `BLOCKED` / `CANCELLED` | `resume` rechecks inputs and selects the earliest affected stage | No implicit retries or finalization |
| `ABORTED` / `COMPLETED` | Terminal | Further work requires a new session |

### 3.1 Budgets and cancellation

A repair attempt is a new agent invocation following a failed validation or rejected output. Default allowance is the initial invocation plus **two repair attempts per stage**, subject to **six repair attempts total per session**. Counters persist across backtracking, restart, and resume. A second design visit does not reset the budget.

Defaults: 10 minutes per agent invocation, 10 minutes per check, 60 minutes active execution per session, and 200,000 combined input/output model tokens. Cached/reasoning tokens are included when reported by the provider. The adapter must expose usage and a hard per-request token ceiling; the orchestrator reserves that ceiling from the remaining budget before dispatch. Unsupported budget enforcement blocks enforced mode. Elapsed time awaiting user action is excluded from active execution time.

Exhaustion enters `BLOCKED` with the last failure, work completed, evidence, and remaining decisions. A user may explicitly raise a budget through CLI configuration; the change is logged and does not retroactively validate evidence. Network/runner errors receive at most one transport retry, also charged to applicable budgets; no blind replay of mutations.

Cancellation terminates the whole process group, records partial output as incomplete, and preserves the workspace. Crash recovery uses a durable event journal. Interrupted checks are rerun; partial outputs never count as approval. `resume` requires a session ID and verifies artifacts, candidate, base, policy, adapter, and environment before continuing. Human edits are imported as a new candidate revision and revalidated.

### 3.2 Task semantics

`motion.json` contains a validated acyclic task graph with stable task IDs, dependencies, authorized paths, and acceptance criteria. MVP runs tasks serially in deterministic topological order, using one session workspace. Cycles, unresolved dependencies, and out-of-scope paths are rejected before implementation.

Task checks provide progress evidence only. Final approval covers the complete combined session change, including contracts, tests, and implementation. Partial success can be inspected/exported but cannot receive the session's verified marker. MVP creates one final commit; independently approved intermediate commits and parallel task integration are deferred.

## 4. Workspace Safety and Enforcement

### 4.1 Isolation and existing work

At preflight, record the source repository identity and committed base SHA. Create a session-owned checkout from that commit with private Git metadata. The original checkout and its index are never mounted writable into an agent or test container. Pre-existing staged, unstaged, and untracked files are excluded; report that exclusion before execution.

If a task depends on existing uncommitted work, block with guidance to provide a committed base or use explicit `--include-dirty`. That option snapshots tracked staged/unstaged changes and separately selected untracked files into the session after showing the inclusion list. It preserves the original index and files, excludes ignored files/secrets by default, and includes imported changes in the final review scope. A snapshot must detect concurrent edits and retry or block rather than mix inconsistent versions.

Acquire a repository session lock before creating mutable state. A second run fails with the active session ID. Stale locks require process/liveness verification; never infer safe removal from age alone. Finalization checks the recorded source HEAD and relevant imported content for divergence and blocks for a new session/rebase-and-review if they changed.

`abort` stops session processes and marks the session aborted. It preserves the isolated candidate and logs for inspection; it never issues reset/clean against the source checkout. `clean --session <id>` explicitly deletes only an inactive session's owned workspace after validating ownership and canonical paths. Artifacts have no automatic deletion in MVP.

### 4.2 Trust boundary

The trusted host orchestrator owns policy, state, artifacts, candidate manifests, ballots, and Git finalization. Each role has a distinct invocation identity and receives only its input snapshot and brokered capabilities. QA and security receive independent contexts and cannot alter each other's results; different model providers are not required, and correlated model errors remain a limitation.

Filesystem allowlists, read-only mounts, process limits, and a tool broker enforce permissions. Removing a named tool from a prompt is insufficient if a shell, script, symlink, or nested process can perform the same operation. Agents and repository code cannot access host Git metadata, orchestrator storage, container-runtime sockets, or host credentials. Paths are canonicalized; traversal and symlink escapes are rejected.

Repository content, generated tests, tool output, and persona files are untrusted input. Agents cannot edit effective policy or grants during a session. Custom personas cannot expand runtime permissions. The broker associates outputs with the invocation identity; a role cannot submit another role's result. Host compromise and malicious actions by the host user are outside this local trust model.

Agent network access is restricted to the configured model endpoint through the broker; credentials stay in the broker. Tests/scanners run separately with no model credentials, no external network, and ephemeral storage. Required dependencies must be provisioned in a pinned validation image/cache before execution. Source sent to the chosen model provider is disclosed by `init`; local secret detection/redaction is best-effort and must not be advertised as guaranteed prevention of disclosure.

**Enforced mode** is the default and supports verified finalization only when all capability checks pass. **Advisory mode**, explicitly selected, can export prompts or review reports when isolation is unavailable, but cannot produce a verified ballot or invoke Quorum commit finalization. Merely editing `quorum_achieved` never grants authority.

## 5. Tests and Validation Evidence

QA maps every acceptance criterion to a check or a documented policy-permitted exception. Before Dev runs, the orchestrator executes the applicable existing baseline suite and records existing failures. Documentation-only sessions run their configured documentation checks instead. MVP blocks on baseline failures rather than automatically waiving them.

For behavior changes, added regression tests must fail on the baseline for the expected behavioral assertion, then pass on the final candidate. Missing imports, syntax errors, missing dependencies, and unavailable services do not establish the required red state. Contract/type changes may use an expected compiler diagnostic when that diagnostic directly expresses the acceptance criterion. Pure refactoring may use passing baseline/final regression evidence instead of inventing a failing test; QA must record the justification. Documentation-only exceptions follow Section 2.2.

QA owns tests, snapshots, fixtures, and acceptance mappings. Dev/refactor cannot modify them, test commands, dependencies used by the harness, or coverage policy through general write tools. Required changes to those protected inputs go through a separate QA proposal and orchestrator validation. Any accepted test change reruns baseline/red evidence and final validation. Security review includes test/configuration changes that could weaken checks.

For each frozen candidate, the orchestrator runs configured tests, lint, typecheck, and policy-required scanners in fresh disposable copies. It captures command identity, image/environment digest, input revision, start/end times, exit code, stdout/stderr references, and tool versions. Validators cannot mutate the canonical candidate. Autofixes are new implementation changes requiring a new revision.

Nonzero exit, timeout, malformed output, unexpectedly empty test discovery, or missing required tooling blocks approval. Warnings are recorded; an error threshold of zero is the default. Coverage is diagnostic in MVP, not a substitute for acceptance evidence. Required check absence is never treated as success; an inapplicable check requires a policy-supported reason in the manifest.

Optional fuzz tests default to 500 cases, a 60-second deadline, 1 CPU, 512 MiB memory, recorded seed, and local mocked dependencies. Completion below the configured case count is incomplete. Crashes, unhandled exceptions, resource-limit exits, and failing invariants block. Memory-leak checks are claimed only when a configured detector and explicit threshold exist. Required fuzzing without a suitable harness blocks; absence of optional fuzzing is recorded as not required.

## 6. Revision-Bound Approval and Commit

### 6.1 Candidate identity

A candidate manifest identifies the base commit, exact proposed Git tree, file modes and deletions, approved tests/contracts, effective policy hash, validation image/configuration digest, and adapter/model versions. Its canonical serialization is hashed as `candidate_id`. `candidate.diff` is a review aid, not the authority for content identity. Artifacts, logs, credentials, and temporary files are excluded from the proposed tree.

Changes to code, tests, contracts, base, policy, or validation configuration create a new candidate identity and invalidate **all final verdicts and check results** in MVP. Evidence reuse across candidates is deferred. Design clearance is separately bound to its contract/risk inputs and cannot count as final security approval.

### 6.2 Evidence ownership and ballot

Roles emit separate schema-validated outputs. The broker writes each result into its own immutable invocation directory using atomic replacement of temporary files. Concurrent validators never write a shared ballot. Every result includes schema version, session/task/invocation IDs, input digest, role, status, evidence references, timestamps, and rejection rationale when applicable. Final checks and reviews additionally require a candidate ID; earlier planning/design/test outputs identify their versioned inputs and cannot satisfy a final vote.

Allowed role verdicts are `APPROVED`, `REJECTED`, and `INCOMPLETE`. Tool execution status is recorded separately so that a successful process exit cannot be mistaken for review approval. Missing, stale, duplicate-conflicting, malformed, or incomplete required results block finalization.

The orchestrator alone computes `ballot.json` from recorded evidence and policy. Required conditions are:

1. Final QA and security verdicts are both `APPROVED` for the same current candidate.
2. All required automated checks passed for that candidate.
3. Required design gates and acceptance mappings are complete.
4. No incomplete tasks, unresolved vetoes, scope violations, or budget overruns remain.
5. Runtime mode is enforced and all integrity checks pass.

The ballot records candidate ID, policy hash, verdict/check references, waived-as-inapplicable checks with reasons, and the computed outcome. There is no majority vote or override of a required rejection. Changing the file's outcome field cannot change the computed decision.

### 6.3 Finalization

`quorum run` stops at `APPROVED` by default for inspection. `quorum commit --session <id>` requests finalization; `run --commit` supplies that authorization at session start. No extra approval is required after an explicit commit request if the candidate remains valid.

Under the session lock, the host recomputes the candidate identity and ballot, checks source divergence, and creates exactly one commit in the isolated repository on `quorum/<session_id>`, parented to the recorded base. It uses an explicit index/tree, never broad staging from the user's checkout. Git hooks from the repository are disabled; any required pre-commit behavior must run as a declared isolated validation check before approval. Commit signing is outside MVP.

Before reporting success, verify that the commit tree exactly matches the approved tree and persist a receipt containing commit ID, parent, tree, candidate ID, and evidence references. Use a durable transaction ID so recovery after a crash detects an existing matching commit instead of duplicating it. Mismatch or ambiguous recovery blocks completion.

Commit messages use an appropriate conventional type and a `Quorum-Session` trailer; `[quorum:verified]` is reserved for enforced approved sessions and is not a cryptographic attestation. Export provides a patch or Git bundle for the developer to import. Importing, cherry-picking, merging, or modifying the change elsewhere does not carry approval to a different tree/base automatically.

## 7. Adapter and Configuration Contract

Quorum owns scheduling and tool execution; a runner supplies model-driven role reasoning. The first adapter must pass the same conformance tests later adapters will use.

Each adapter implements capability discovery, launch, structured output collection, usage accounting, timeout/cancellation, and process cleanup. A request includes protocol version, invocation ID, role, task, immutable input references, tool grants, working directory, response schema, and budget. A result includes protocol version, invocation ID, output references, usage, exit status, and normalized error category.

Authentication is configured by the user and brokered outside repository execution. Secrets never appear in arguments, committed files, or ordinary logs. Unsupported versions, missing structured output, inability to constrain tools, inability to stop descendants, or absent usage limits fail preflight in enforced mode. Runner-specific prompts and slash commands are convenience frontends to this contract, not equivalent enforcement mechanisms.

| Integration | Release scope |
| :--- | :--- |
| Claude Code | First planned adapter; version and actual invocation validated and pinned before release |
| Codex | Deferred; requires capability and conformance tests before support is advertised |
| `agy` | Deferred; requires an identified runner/version and tested integration |
| Bash/Zsh | Hosts the Quorum CLI; still requires a configured agent adapter and model backend |

`quorum init` creates `.quorum/config.json` and persona templates without overwriting existing configuration. Configuration includes adapter/version, model, mode, validation image digest, commands expressed as executable/argument arrays, permitted environment keys, path scopes, sensitive-path rules, and budgets. Configuration is validated against a versioned schema and frozen per session. Effective changes cannot be smuggled in through candidate edits.

Persona markdown supplies role instructions and declared desired tools. Runtime policy is the source of permission authority. The source checkout may contain editable templates; a session uses a recorded immutable copy.

## 8. Artifact Storage and CLI

```text
.quorum/
  config.json                    # Versioned repository configuration
  agents/                        # Persona templates
  sessions/<session_id>/         # Host-owned; not agent-writable
    state.json                   # State, counters, pinned inputs
    events.jsonl                 # Durable execution journal
    motion.json                  # Validated task graph and acceptance criteria
    contracts/                   # Versioned contract artifacts
    candidates/<candidate_id>/
      manifest.json
      candidate.diff
      checks/<check_id>.json
      reviews/<invocation_id>/result.json
      ballot.json
    escalation.json
    receipt.json
```

Isolated workspaces live in a separate host-managed location identified in state, outside agent-accessible artifact storage. `current` is an optional display convenience only; mutation always resolves an explicit session ID under the repository lock. All machine-readable records have schema versions; unknown major versions block resume with migration guidance.

Artifacts are private to the local user by default, excluded from version control, and retained until explicit cleanup. Logs redact known credential patterns and bound output size; overflow is recorded. Reports must not silently truncate evidence needed to interpret failures. Diagnostic exports exclude source/log bodies unless explicitly included by the user.

```bash
quorum init
quorum doctor                         # Capability/configuration validation
quorum run "Implement the requested change"
quorum run "Implement the requested change" --commit
quorum status --session <id>
quorum diff --session <id>
quorum resume --session <id>
quorum cancel --session <id>           # Stop processes; retain resumable state
quorum abort --session <id>            # Terminal; preserve isolated work
quorum commit --session <id>           # Requires current enforced approval
quorum export --session <id> --format patch
quorum clean --session <id>            # Delete inactive session-owned workspace
quorum dispatch /sec "Audit this change" --session <id>
```

Direct read-only dispatch returns a standalone report and cannot advance a full session or supply a ballot vote. Direct mutating dispatch creates an isolated unverified draft with the same write restrictions; it cannot modify a frozen/approved candidate. Adoption into a full session creates a new revision and runs the normal gates. `/git` is an alias for `commit` and never accepts arbitrary unapproved changes. Unknown role names fail explicitly. Native slash-command exports are deferred until the relevant adapter is tested.

CLI exit codes: `0` requested operation succeeded (status reports state separately), `2` invalid command/configuration, `3` blocked or rejected run/finalization, `4` runtime/infrastructure failure, `130` cancellation. `--json` returns a schema-versioned machine-readable result. Status includes stage, candidate, outstanding gates, budget usage, and the next actionable remediation.

## 9. Acceptance Criteria and Measurement

Release requires automated fixtures demonstrating:

1. A standard change completes with QA/security approval and a commit whose tree equals the approved candidate.
2. A final implementation vulnerability is rejected even when its original design was approved.
3. Editing code, tests, policy, or validation inputs after approval makes finalization fail until checks and reviews rerun.
4. Forged ballots, swapped role outputs, missing/stale results, and concurrent result writes cannot grant approval or lose evidence.
5. Dirty source checkouts retain identical file contents, index state, and untracked files after success, cancellation, abort, and failure.
6. Scope escapes through shells, child processes, symlinks, Git access, network access, and test execution are denied in enforced mode; unavailable enforcement blocks that mode.
7. Crash injection at every persisted transition, including commit creation, resumes safely without duplicate commits or accepted partial evidence.
8. A second session is rejected by locking, source divergence blocks finalization, and cleanup cannot delete paths outside the owned workspace.
9. Expected behavioral test failure is distinguished from infrastructure failure; empty discovery and unauthorized test weakening block approval.
10. Retry exhaustion, usage exhaustion, cancellation, and timeouts stop work and preserve a useful escalation report.
11. Documentation-only and pure-refactor policies produce justified evidence without fabricated failing tests; required fuzz checks cannot be silently skipped.
12. Every advertised adapter/version passes launch, schema, isolation, accounting, cancellation, and recovery conformance tests.

Maintain a fixed benchmark of 20 representative TypeScript tasks: 10 routine fixes, 4 sensitive changes, 3 refactors, and 3 documentation changes. Release target: at least 16 tasks accepted by a human reviewer without manual code repair within default budgets, and zero false approvals on the separate seeded gate-bypass/safety fixtures. These targets measure the fixture set, not universal reliability.

Report completion rate, false approvals/rejections, median/p95 wall time, token usage, model cost when pricing is configured, number of model calls, and repair count. Compare with a single-agent baseline using the same tasks, model, and test environment. Target median routine-task latency at most 15 minutes and model token usage at most three times that baseline. If missed, reduce redundant stages before adding agents. No role is justified solely by having a distinct persona.

## 10. Delivery Plan

### Phase 1: Feasibility and safety foundation

- Validate and pin the first runner invocation, versions, usage reporting, cancellation, and isolation capabilities.
- Define artifact/configuration schemas and implement the state machine, budgets, locks, journal, and isolated workspace lifecycle.
- Implement the broker and protected-path enforcement; prove dirty-worktree preservation, escape prevention, and safe cleanup before agent mutations.
- Implement candidate identity, evidence ownership, ballot computation, and recoverable Git finalization with fake-agent fixtures.

### Phase 2: Minimal useful workflow

- Add plan, Dev, QA, and final security responsibilities.
- Add deterministic tests/lint/type checks, conditional design review, and explicit documentation/refactor policies.
- Deliver CLI inspection, resume, cancellation, abort, commit, and export.
- Pass safety/conformance acceptance tests and publish benchmark results and supported-version manifest.

### Phase 3: Evidence-led extensions

- Add additional adapters and language stacks only with conformance coverage.
- Add optional refactoring specialists and bounded fuzz/fault tooling when benchmarks demonstrate value.
- Consider parallel tasks, multiple commits, remote CI/merge enforcement, and stronger attestations as separate specifications.
