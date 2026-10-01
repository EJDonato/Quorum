# Early feasibility and performance checkpoints

Status: diagnostic probe work implemented; production enforcement and performance remain unproven. This is an investigation sequence, not a change to the PRD's approval gates or release scope.

## Adapter diagnosis and control

Probe result schema 1.1.0 adds safe protocol-failure stages and host timings. Failures distinguish outer JSON, envelope, status, usage, response JSON, response schema, and event sequencing. Antigravity failures include types/presence of only five known envelope fields. Unknown property names, field values, Zod issue messages, and raw provider output are excluded. These additions do not relax required response schemas or confer approval. Earlier 1.0.0 evidence is retained unchanged and cannot acquire diagnostic details retroactively.

Regression coverage includes malformed envelopes, missing/invalid usage, incorrect response types/values, unknown secret-bearing field names, terminal escapes, incomplete execution, and report timing metadata. A failing diagnostic test revealed that missing usage was classified too early as an envelope failure; the parser now validates the envelope object before validating each required field, preserving rejection while improving diagnosis.

The next enforcement experiment needs an inert broker fixture and an isolated execution environment. Enumerate the exact effective tools, deny non-broker shell/file/network/delegation effects, then exercise those paths. Investigate Codex's pinned app-server interface; do not assume tool toggles or dynamic tools remove built-ins. Establish an equivalent tested Antigravity interface before claiming parity. Separately prove hard request ceilings, reservations over tool iterations/retries, and interrupted accounting. Successful JSON alone satisfies none of these gates.

## Container checkpoint during M3

Measure before committing to a workspace/dependency transport design:

- Cold and warm runtime/image startup.
- Snapshot transfer into the Linux environment.
- Dependency provisioning versus warm dependency reuse.
- Tests, lint, and typecheck execution, separate from setup.
- Complete validation time for a small representative TypeScript repository.

Use the same tree, lockfile, image/runtime digests and commands for each comparison. Record host/container versions and sample counts. A cold run is a separate condition, not a failed run erased by warming. Do not attribute observed time to VirtioFS without measurements.

Provision Linux-compatible dependencies from a trusted pinned image/cache. Key dependency reuse by lockfile, image, runtime, architecture, and installation options. Untrusted checks must not be able to poison future runs: use read-only shared material with disposable writable state where tools require it. Do not repeatedly import host `node_modules`, share writable untrusted caches, reuse final candidate evidence, or weaken fresh validation isolation for speed. VM-local storage is a candidate to measure, not a proven implementation choice.

## Workflow checkpoint before M7

Instrument the first complete offline/live vertical slices, then run a small preliminary set of routine tasks before spending on the full benchmark. Record setup, planning, QA authoring, development, validation, final QA, and final security time separately, plus tokens, known cache/reasoning fields, invocations, and repairs. Current probe timings cover version discovery and the runner invocation only; they do not measure containers or a complete workflow.

Check whether routine tasks fit the 200,000-token budget without repairs and with ordinary repairs. Measure context overhead instead of extrapolating the one-message smoke tests as guarantees. Keep design review conditional according to existing risk policy; retain independent final QA/security approvals for the exact candidate. Reduce irrelevant context and redundant model work before changing required gates.

The fixed 20-task release benchmark, 15-minute median routine-task target, three-times-baseline token target, and safety acceptance fixtures remain required. Preliminary task results do not replace them.

## Current outcome

The instrumented attempt diagnosed our Antigravity envelope assumption: the parser read the free-text slot rather than the documented parsed-schema slot. The corrected parser is covered offline, but no successful corrected live attempt is claimed. Both failures remain retained. Broker-only effects, hard ceilings, container performance, and full workflow performance remain unresolved.

## Verification

Lint, strict typecheck, size, build, 19 unit tests and 21 integration tests passed after the parser correction. Changed-file formatting and `git diff --check` passed. Whole-project `npm run check` is not green: unrelated contract files being added concurrently fail formatting, and schema consistency stops at missing `schemas/Motion.json` from the concurrently expanded export inventory. Those files were preserved. The earlier diagnostic regression failure was corrected in the parser rather than skipped. One approved live diagnostic attempt was made, failed, and retained; no live verification of the corrected parser was performed. No container or complete workflow benchmark was run.
