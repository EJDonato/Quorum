# Baseline and expected-red test preparation

Status: implemented host validation/scheduling slice on 2026-10-02. M3/M4 remain partial. Production runner integration, durable effect accounting, and CLI workflow readiness remain blocked.

The validation executor now accepts either a final candidate or a host-created preparation snapshot. Baseline and expected-red identities bind the session, phase, baseline tree, executed tree, configuration, environment, motion, and QA specification using canonical hashes. Changing any bound input invalidates the evidence. The same immutable Git export, Docker profile, structured-report requirements, deadline supervision, and cleanup rules apply to all three phases. `checks.run` can use a preparation snapshot through a host-bound check port; a role cannot supply the snapshot, executable, arguments, or host paths.

`TestSpecification` maps every accepted motion criterion exactly once to a configured check. Unknown, duplicate, missing, or extra mappings block. The host supplies the approved change classification and scope; QA cannot select an exception or expand the configured grants. Behavioral changes require assertion failure IDs. Contract changes can identify the supported TypeScript assignability diagnostics `TS2322`, `TS2345`, `TS2416`, or `TS2741`; other compiler diagnostics are unsupported in this slice. Missing-module diagnostic `TS2307` cannot serve as contract red. Refactoring uses passing baseline/regression evidence with a justification, and documentation uses passing documentation checks with a justification and documentation-only configuration. These exceptions still depend on trusted host classification; this is not a production diff/risk classifier.

The new `failure_ids` report/result field is optional for compatibility with existing final reports, but required for expected assertion/diagnostic red. The host requires exactly the frozen expected IDs, with no missing, additional, or duplicated IDs. A failing process alone does not qualify. Infrastructure/compiler failures cannot stand in for behavioral red; timeout, cancellation, empty discovery, malformed reports, and missing tooling block preparation. A passing check cannot carry nonempty failure IDs. Configured wrappers must report actual tool observations; no native test/TypeScript parser or generic wrapper was added.

`scheduleTestPreparation` validates inputs before effects, verifies the QA overlay, then runs all configured baseline checks in deterministic order. Each persisted check is read back and hash/identity verified. Baseline failure prevents any red scheduling. Mapped red/regression checks run next; any unsatisfied mapping stops acceptance. Production composition saves immutable configuration, motion, specification, and snapshot records before execution, then writes a receipt only after the complete evidence set passes host evaluation. Check intents/results remain separate records; a failed attempt cannot become an acceptance receipt.

This first overlay workflow permits only added files within configured host-granted test paths. Production edits, renames, deletions, and modifications to existing tests block. Actual Git tree comparison proves the overlay scope; it does not trust an agent's changed-path list. Existing-test revision and other protected changes need a separate QA proposal/host validation workflow. Links and unsupported snapshot content are still rejected by the executor.

`runSession` now requires a host test-preparation evidence loader. After QA authoring, it verifies the baseline against the recorded base commit, checks that the current draft is the recorded QA tree, verifies the overlay, and evaluates the complete receipt against the frozen configuration/plan/specification/test identities. It saves the receipt before recording `TEST_SPEC_ACCEPTED`. Successful author callbacks cannot authorize implementation. The existing workflow fixtures now supply visibly synthetic preparation records; the fixture test file moved under its declared QA test directory to satisfy the actual scope gate.

Relevant modules are `src/contracts/test-specification.ts`, `src/domain/test-preparation.ts`, `src/application/{preparation-snapshots,test-preparation-input,schedule-test-preparation,evaluate-test-preparation,workflow-test-preparation}.ts`, and `src/infrastructure/validation/{qa-overlay,preparation-composition}.ts`. Generated schemas publish the preparation snapshot, specification, receipt, host policy, and extended check/report contracts. PRD product behavior did not change.

## Verification

The routine suite remains offline. Regression fixtures cover mapping completeness, classification/grant restrictions, stale and forged inputs, all-baseline-before-red ordering, dirty checkout/index preservation, expected failure matching, missing imports, scope violations, existing-test weakening, receipt/input persistence failure, evidence hash mismatch, preparation broker binding, and refusal to enter implementation without complete preparation evidence. Fake Docker and workflow records are clearly marked and cannot establish production capabilities.

The opt-in command remains:

```sh
npm run test:validation:container -- --image 'IMAGE@sha256:DIGEST' --socket '/absolute/path/to/docker.sock'
```

Replace both placeholders. Eight real fixtures passed with no failures or skips on Docker 29.6.2, Linux arm64, using the cached image recorded in [the validation executor report](configured-validation.md). The two added fixtures run a real Node assertion: the frozen baseline passes, the QA-overlay tree fails for the specified assertion, and a separate missing-dependency run is rejected as infrastructure failure. The six existing isolation/cancellation fixtures also passed. No images were pulled, dependencies installed, models invoked, or task benchmarks run. Compiler-diagnostic acceptance has offline fixtures; it was not tested against a real TypeScript compiler.

An initial timeout regression used an unsupported fake-Docker option and therefore failed to inject interruption. The fixture was corrected to use the adapter's real `interrupted` option; the check and expectation were retained.

Final verification: `npm run check` passed formatting, lint, strict typecheck, size, build, generated-schema comparison, **42 unit tests and 118 integration tests**, with zero failures or skips. The authored-file live fixture was additionally checked with lint/typecheck and the separate container command.

## Remaining work and next assignment

There is no production role invocation/submission protocol, complete prerequisite verifier, native report wrapper, or CLI run/approve/commit wiring. Host classification and authorization/time callbacks are still external prerequisites. Full protected-file reconciliation against the final tree, accepted test revisions, complete restart/backtracking reconciliation, and model accounting remain unfinished. The preparation receipts do not approve a final candidate or satisfy QA/security final reviews.

Next assignment: integrate check scheduling with durable workflow effect and budget records. Persist reservations and attempt identity before dispatch, retain charges/failures across interruption and backtracking, and reconcile incomplete effects through owned cleanup without automatically replaying checks. Test failures after reservation, dispatch, cleanup, result persistence, and receipt publication, plus exhausted budgets after restart. Re-evaluate preparation when its bound inputs change. Keep production enforced operation blocked until authenticated grants, final protected-file checks, and runner conformance exist.
