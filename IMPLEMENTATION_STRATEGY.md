# Quorum Implementation Strategy

**Status:** Execution plan; foundation contracts and host decision subset implemented, milestones remain incomplete\
**Baseline:** PRD version 2.2.0\
**Scope:** First usable, enforced CLI release

## 1. Purpose and Source of Truth

This document defines what to build first, how to divide the work, and what evidence is required before moving to the next milestone.

- [PRD.md](PRD.md) defines product behavior, scope, and release acceptance criteria.
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) defines architecture, data contracts, user flows, and technical edge cases.
- [AGENTS.md](AGENTS.md) defines coding principles, size limits, implementation boundaries, and verification practices.
- This document defines delivery sequence and milestone completion. It does not override the other specifications.

M0 remains blocked, and M1–M4 have implemented subsets rather than completed production exit gates. Current evidence is documented in [the foundation report](docs/implementation/foundation.md), [contracts/ballots report](docs/implementation/contracts-and-ballots.md), and [enforcement correction report](docs/implementation/enforcement-corrections.md). Proposed paths, scripts, and reports beyond that subset are deliverables to create, not existing capabilities. Mark work complete only after its evidence exists.

## 2. Delivery Approach

Build the trusted engine before connecting autonomous agents to writable workspaces. Prove a small end-to-end workflow with deterministic fake roles, then integrate Antigravity (`agy`) and Codex one at a time without changing the approval or isolation rules.

The first complete development slice is a single-task bug fix in a disposable TypeScript repository: configure → plan → establish a failing behavioral test → implement → freeze → validate → obtain QA/security results → inspect → explicitly commit → export. It must also demonstrate rejection and recovery. A demo that only succeeds is insufficient.

Keep one package, one selected runner per session, one session per repository, serial tasks, and one final commit. Antigravity (`agy`) and Codex are the two initial integration targets because they serve the daily-driver workflows; both belong to this release. Linting is a configured check. Refactoring is conditional. A dedicated chaos agent, adapters beyond Antigravity and Codex (including Claude Code), parallel implementation, and web UI remain outside this release.

Resolve feasibility risks early without prematurely building integrations. Initial probes use disposable fixtures and minimal contracts; production integration follows the tested engine and sandbox. A fake runner demonstrates engine behavior but never establishes real enforcement capability.

## 3. Milestones and Dependencies

| Milestone | Outcome | Depends on | Completion evidence |
| :--- | :--- | :--- | :--- |
| M0 | Antigravity and Codex feasibility understood | Existing specifications | Separate capability findings, reproducible probes, recorded decisions |
| M1 | Buildable CLI and validated contracts | M0 investigation; independent scaffolding may proceed during investigation | Build/check scripts, schema fixtures, CLI smoke checks |
| M2 | Durable session engine | M1 | Transition, budget, journal, lock, and recovery tests |
| M3 | Safe workspaces and brokered effects | M2 and successful M0 capability decision | Preservation and sandbox boundary fixtures |
| M4 | Complete offline workflow and exact-tree finalization | M3 | Fake-role end-to-end fixtures and commit receipts |
| M5 | Antigravity and Codex adapters and required roles | M4 | Per-adapter conformance and bounded live smoke results |
| M6 | Complete MVP journeys and conditional gates | M5 | CLI journey and policy regression suite |
| M7 | Release qualification and packaging | M6 | Full PRD acceptance matrix, benchmark, install smoke report |

The enforced release depends on a successful M0 result. If feasibility fails, deterministic engine work can remain useful, but real-runner integration and enforced release remain blocked until the design is explicitly resolved. Do not substitute advisory behavior and call the milestone complete.

Milestone gates are evidence checks, not recurring permission requests. Proceed with already authorized work when a gate passes. Publishing or other externally consequential operations still require applicable authorization.

### M0 — Validate the Hard Assumptions

**Objective:** Establish whether each of Antigravity (`agy`) and Codex can satisfy the product's enforced-mode contract.

Tasks:

- For each initial target, identify the actual integration surface and verify runner invocation, supported version, authentication, structured output, and model selection without assuming example flags exist. Treat `agy` as the Antigravity target label until the executable/contract is verified.
- Demonstrate that all role effects can be restricted to the broker; test whether built-in shell/filesystem tools can bypass it.
- Probe credential separation, model-endpoint access, container isolation, and termination of descendant processes.
- Verify enforceable request token ceilings and usage accounting across a multi-call role invocation. Record how reservations cover tool iterations, provider retries, and incomplete accounting.
- Identify supported Node.js, Git, container runtime, runner, and model versions for a candidate release manifest.
- Record minimal reproductions, observed limitations, and a separate proceed/block decision for each target in `docs/decisions/runner-feasibility.md`.

**Exit gate:** Every mandatory capability must have observed passing evidence for each pinned runner, or the user must explicitly revise product scope and the PRD/design. An unresolved blocker keeps M0 blocked. An unsupported capability cannot be represented as supported by a prompt, timeout alone, or post-hoc usage estimate. Evidence from one target does not establish support for the other.

### M1 — Establish the Package and Contracts

**Objective:** Create the smallest maintainable codebase that can validate inputs and expose the CLI structure.

Tasks:

- Scaffold one strict TypeScript package, executable entry point, lockfile, and minimal composition root.
- Choose and pin the CLI parser, schema tooling, and test tooling based on required capabilities. Avoid additional frameworks unless justified.
- Provide documented scripts for formatting checks, lint, typecheck, build, unit/integration tests, and the size checks required by AGENTS.
- Implement runtime schemas and inferred types for configuration, session, motion, candidate, invocation, checks, reviews, ballot, events, and commit receipt.
- Establish typed error codes, version handling, canonical serialization, host-generated IDs, and injected clock/ID interfaces.
- Add `init`, configuration inspection, and initial `doctor` behavior. Unsupported commands must return an explicit diagnostic, never simulated success.
- Generate JSON Schema exports from the same source definitions; add examples of valid and rejected boundary data.

**Exit gate:** A fresh development install builds, checks pass, invalid configuration is rejected before effects, and initialization preserves existing files. The CLI consistently separates JSON stdout from progress stderr.

### M2 — Implement Durable Session Control

**Objective:** Make execution state, retry accounting, and recovery reliable independently of any model.

Tasks:

- Implement the pure transition reducer using the PRD's states, including blocked, cancelled, and terminal paths.
- Add DAG validation, stable serial ordering, acceptance-criterion references, and role/phase scheduling decisions.
- Implement per-stage and overall repair counters, token reservations, active execution deadlines, and explicit budget increases.
- Add durable intent/completion events, immutable artifact writes, projection rebuilds, and schema-version checks on resume.
- Implement canonical repository identity, persistent session leases, short-lived command locks, and stale-owner verification.
- Add `status`, `cancel`, `abort`, and `resume` application handlers using simulated effects. Runtime availability is reported honestly until integration is complete.
- Build fault-injection helpers for partial writes, interrupted effects, out-of-order events, and missing result artifacts.

**Exit gate:** Replay reconstructs the same state; invalid transitions are rejected; budgets survive restart/backtracking; two sessions cannot acquire the same repository lease. Corruption and uncertain effect completion block instead of advancing.

### M3 — Implement Workspace Safety and the Broker

**Objective:** Establish the boundary required before any agent or repository program executes.

Tasks:

- Snapshot committed source into a private repository with independent Git metadata; sanitize Git environment, configuration, hooks, and filters.
- Record source/index fingerprints and workspace ownership. Never expose the source checkout as a writable execution mount.
- Implement scoped reads/search, patch application, artifact access, configured-check requests, role submission, and scope requests from the system-design tool inventory.
- Enforce role and phase grants, protected paths, expected draft digests, bounded output, and canonical path rules at the effect boundary.
- Execute checks in disposable containers without model credentials or external network access; provide dependencies through a pinned image/cache.
- Add process-tree cancellation, resource limits, redacted diagnostics, and terminal escaping.
- Implement safe cleanup with ownership verification, inactive-workspace checks, and explicit disclosure of lost resumability or unexported work.

**Exit gate:** Fixtures prove preservation of staged, unstaged, and untracked source changes across success and failures. Shell, child-process, symlink, network, Git, and artifact-write escape attempts are denied. Unconfirmed process cleanup blocks dependent actions.

### M4 — Complete the Offline Vertical Slice

**Objective:** Exercise the full trusted workflow using fake role outputs and real isolated checks.

Tasks:

- Freeze candidate manifests from exact trees and policy/input digests; invalidate final evidence on every relevant revision change.
- Execute baseline, expected-red, and final tests; distinguish behavioral failure from infrastructure failure and empty test discovery.
- Persist separate host-bound check/review results; reject stale, missing, conflicting, or forged evidence.
- Compute ballots from current evidence instead of trusting a serialized outcome flag.
- Implement `run`, `diff`, `commit`, and patch/bundle `export` over the offline fixture workflow.
- Implement deterministic finalization intent, commit-object creation, compare-and-swap ref update, receipt verification, and transaction recovery.
- Add success, rejection, exhausted retry, post-approval mutation, source divergence, and crash-during-finalization fixtures.

**Exit gate:** One fixture change completes and its private commit tree equals the approved candidate. Rejected or modified candidates cannot finalize. Every injected finalization crash resumes to the same transaction without duplicate commits. The source checkout remains unchanged.

Fake-role integration is available through test wiring, not a production flag that fabricates capability checks or verified results.

### M5 — Integrate Antigravity and Codex

**Objective:** Replace fake role reasoning with the validated Antigravity (`agy`) and Codex adapters, one at a time, while retaining the same trusted execution paths. Start with a target cleared by M0; both must pass before this milestone is complete.

Tasks:

- Implement capability discovery, invocation, schema-bound output collection, usage accounting, normalized errors, cancellation, and cleanup for each adapter through the shared port. Select one runner per session; do not introduce automatic fallback or mixed-runner sessions.
- Convert successful M0 probes into repeatable conformance tests against pinned versions.
- Add versioned Planner, QA test-authoring, Dev, final QA, and final Security prompt templates from AGENTS.
- Bind context to immutable artifacts; keep role results separate and omit cumulative chat history from role handoffs.
- Integrate brokered model credentials and bounded requests without exposing them to repository checks.
- For each adapter, run a small explicitly budgeted live standard-change fixture and a seeded rejection fixture. Preserve raw execution status separately from review verdicts.

**Exit gate:** Each initial adapter produces complete evidence in a real run under enforced permissions, and its rejection fixture blocks finalization. Required accounting, cancellation, and capability tests pass. Paid/live tests remain separate from the default offline development suite.

### M6 — Complete User Journeys and Policy Variants

**Objective:** Cover the remaining MVP behavior without expanding the agent count by default.

Tasks:

- Add sensitive-change classification, conditional architecture/design review, and late risk escalation.
- Implement documentation-only and pure-refactor evidence policies; preserve final QA/security requirements.
- Add configured bounded fuzz checks where required by repository policy; missing harnesses block those tasks.
- Implement explicit dirty-change import with inclusion selection and consistent snapshot verification.
- Complete standalone read-only dispatch, isolated unverified mutating drafts, and adoption through a new normally validated revision.
- Complete explicit advisory operation with visibly unverified output and no verified finalization path.
- Finalize `doctor`, text/JSON status, next-action guidance, budget diagnostics, exit codes, non-TTY behavior, and clean/export interactions.
- Test cancel → resume, block → remediate → resume, abort → export, and commit-crash → recover journeys.

**Exit gate:** Every core journey and command in PRD Section 8 has a passing behavior fixture. Exceptions are policy-backed and recorded; none turns unavailable evidence into approval.

### M7 — Qualify and Package the Release

**Objective:** Establish that the release meets the documented acceptance criteria and can be installed reproducibly.

Tasks:

- Run the complete safety, recovery, adapter, and CLI acceptance matrix below.
- Run the fixed 20-task benchmark and equivalent single-agent baseline using recorded models, environment, budgets, and evaluation criteria.
- Report failures as well as successes; do not replace failed benchmark tasks with easier ones or hide reruns.
- Inspect an npm package archive to ensure it includes required built assets, prompts, and schemas, and excludes credentials, session artifacts, private repositories, and fixtures not needed at runtime.
- Smoke-test installation and the full standard journey from the archive in a fresh supported environment.
- Publish the supported-version manifest, setup instructions, known limitations, benchmark results, and troubleshooting guidance alongside the release candidate.

**Exit gate:** All mandatory PRD criteria pass, benchmark targets are met, and installation smoke checks pass. A release candidate is a local reviewable package; uploading it to a registry is a separate authorized action.

## 4. Acceptance Traceability

Numbers refer to the twelve numbered acceptance criteria in PRD Section 9. Tests must assert the behavior, not merely carry the requirement label.

| PRD criterion | Primary implementation | Required evidence |
| :--- | :--- | :--- |
| 1. Approved standard change and exact commit tree | M4–M5 | Offline and live standard-change fixtures |
| 2. Final implementation security rejection | M5–M6 | Cleared design followed by rejected vulnerable candidate |
| 3. Post-approval changes invalidate evidence | M4 | Code/test/policy/environment mutation cases |
| 4. Forged, stale, conflicting, or missing evidence | M2–M4 | Artifact identity, corruption, and submission fixtures |
| 5. Existing work survives every outcome | M3, M6 | Content/index/untracked preservation comparisons |
| 6. Scope and isolation enforcement | M0, M3, M5 | Escape-denial and capability conformance tests |
| 7. Crash recovery without duplicate effects | M2, M4 | Fault injection at durable transitions and finalization boundaries |
| 8. Locking, divergence, and cleanup safety | M2–M4 | Concurrent commands, changed source, hostile cleanup paths |
| 9. Valid red/green evidence and protected tests | M3–M4 | Behavioral-vs-infrastructure and unauthorized weakening cases |
| 10. Bounded retries, usage, and cancellation | M2, M3, M5 | Exhaustion, uncertain usage, timeout, descendant termination |
| 11. Justified exceptions and required fuzzing | M6 | Documentation/refactor/fuzz policy fixtures |
| 12. Initial and advertised adapter conformance | M0, M5, M7 | Separate version-specific capability and recovery reports for Antigravity and Codex |

Release benchmark targets remain those in the PRD: at least 16 of 20 tasks accepted by a human reviewer without manual code repair within default budgets; zero false approvals in the separate seeded safety fixtures; median routine-task latency at most 15 minutes; model token usage at most three times the equivalent single-agent baseline. Report median/p95 latency, token/cost data, repairs, and false approvals/rejections. These are release targets, not achieved results.

## 5. Work Breakdown and Change Discipline

Each implementation task should describe:

1. Requirement and observable result.
2. Prerequisites and affected modules/contracts.
3. Smallest cohesive change and explicit exclusions.
4. Success, rejection, and recovery cases relevant to that change.
5. Verification commands and evidence produced.
6. Documentation impact and remaining limitations.

Use reviewable changes organized around behavior, such as “reject stale candidate evidence” or “resume an interrupted commit transaction.” Do not group unrelated work into a milestone-sized patch. Follow AGENTS size limits without splitting cohesive logic solely to meet a count.

Create decision records only for consequential choices: runner feasibility, schema tooling, canonicalization, isolation profile, or an unavoidable size exception. Avoid duplicating the PRD or maintaining a second independent inventory of states and tool names.

For every milestone, retain a short completion report under `docs/implementation/` with status, implemented scope, checks executed, artifact references, skipped checks with reasons, and unresolved blockers. Reports may be introduced as milestones execute; empty placeholder files are unnecessary.

## 6. Verification and CI Strategy

Use three distinct lanes:

| Lane | Trigger | Contents |
| :--- | :--- | :--- |
| Fast/offline | Every relevant code change | Format, lint, typecheck, size, build, pure unit tests, fake-adapter protocol tests |
| Integration/safety | Changes to state, storage, broker, Git, process, or sandbox boundaries; all release candidates | Temporary-repository journeys, real isolated checks, escape attempts, crash injection |
| Live/conformance/evaluation | Explicit bounded runs for adapter changes and release qualification | Pinned real adapter, provider accounting, reviewer behavior, benchmark |

Unavailable container or provider infrastructure is a reported missing verification condition, not a pass. No paid model calls occur in the default test command. Introduce caching only after measuring slow checks, and never reuse final session approval evidence across candidates to accelerate tests or production runs.

When a regression appears, stop dependent feature work, reproduce it, identify the responsible layer, fix it, and rerun the failing scenario plus relevant coverage. Do not change model prompts to mask a host-enforcement defect.

## 7. Risks and Decision Triggers

| Risk | Detection point | Required response |
| :--- | :--- | :--- |
| Runner cannot support broker-only effects or hard token ceilings | M0, reconfirmed M5 | Block enforced adapter support; record evidence and resolve design explicitly |
| Container/network/credential isolation does not match the promised boundary | M0–M3 | Fix or narrow supported environments before real mutations |
| Durability behavior differs across supported hosts/filesystems | M2–M4 | Test actual environments; declare unsupported combinations rather than assume equivalent guarantees |
| Legitimate work needs protected test/configuration changes | M4–M6 | Use QA/host proposal path; never broaden Dev's generic permissions |
| Repeated gates cost too much or add excessive latency | M5–M7 | Measure by stage; remove redundant model work while retaining required evidence |
| QA and security share correlated model blind spots | M5–M7 | Maintain independent contexts and seeded adversarial cases; report measured limitations |
| Safety work expands beyond the intended MVP | Every milestone | Keep supported inputs/runtimes narrow; defer features rather than remove guarantees |

Do not assign calendar delivery dates before M0 findings and the first offline slice establish actual effort. Track completed gates, remaining work, and blockers; revise forecasts using measured progress.

## 8. Immediate Starting Backlog

Historical starting backlog (not full milestone exit gates):

- [x] Confirm repository state and reread the three governing specifications.
- [x] Define reproducible M0 probes and record the exact unverified capabilities.
- [x] Establish the minimal M1 package and offline fixture harness needed for those probes and subsequent engine work.
- [x] Record observed feasibility results; pin proven versions or identify blockers.
- [x] Implement the initial schema/error contracts and pure session reducer.
- [x] Demonstrate one rejected transition and one crash-replayed transition before connecting real model-driven mutations.

Rejected transitions, durable journal reconstruction, stale-cache rejection, and interrupted finalization recovery are tested offline. Full workflow effect/restart reconciliation remains pending. M0 remains BLOCKED: candidate Codex enforcement components, Antigravity hook/upstream components and generic cgroup cancellation exist, but the pinned runners have not passed the final containerized conformance path. Antigravity's real hook and provider stream semantics remain unverified; `test:conformance` and capability-aware `doctor` remain unavailable.

Next: integrate containerized runner adapters with the broker and workflow orchestrator, followed by release-only conformance evaluation. Production runner integration still requires observed conformance evidence.

This strategy authorizes no implementation or publication by itself. Implementation began after the user's explicit request; publication still requires separate authorization.
