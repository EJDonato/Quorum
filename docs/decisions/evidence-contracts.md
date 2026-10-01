# Evidence contracts and host decision boundary

Status: implemented in the second foundation slice; production effect ports are pending.

Record schemas remain version `1.0.0`, with strict unknown-field rejection and generated JSON Schema. Runtime refinements and domain checks are also mandatory: JSON Schema alone does not validate graph semantics, identity hashes, usage arithmetic, or evidence bindings. Model review bodies contain only verdict, findings, reasons, and references; the host attaches role, phase, invocation, and candidate identity.

Candidate identity uses canonical serialization version 1. It includes the configuration digest as well as every frozen dependency specified in SYSTEM_DESIGN Section 4. Timestamps and generated outcomes are excluded by rejecting them as unknown fields. This computes an identity; it does not prove that the referenced Git tree exists or respects scope.

Normalized usage counts all input tokens including cached input, and all output tokens including reasoning. Cached and reasoning counts are subsets. `charged_tokens` is at least input plus output and must fit the invocation's precharged reservation. Missing/incomplete usage prevents successful invocation evidence. Failures may preserve partial or absent usage, but this slice never refunds reservations; restart-safe reconciliation remains future work. These record checks are not a provider-enforced hard ceiling.

A check's `SUCCEEDED` status means process/protocol completion, not passing behavior. Passing requires zero exit, a complete report, no errors or failure classification, positive test discovery for test checks, and all required fuzz cases. Expected red requires a completed, nonzero, classified behavioral test failure or compiler typecheck failure. Infrastructure failure and an empty test suite never count as red. Matching red evidence to baseline and acceptance criteria belongs to the future host prerequisite verifier.

The host ballot API reads and hashes raw artifacts before schema parsing, verifies candidate identity, binds final review records to host requests and invocation outputs, and computes the decision afresh. Ballots retain check, review, request, and invocation references. Required check IDs, kinds, commands, environment, final candidate, and policy must match. Advisory mode, missing evidence, incomplete/rejecting reviews, duplicates, and stale identities block approval.

The injected prerequisite verifier must establish frozen policy/configuration/plan/acceptance identities, task completion, design clearance, acceptance coverage, baseline/red evidence or explicit policy exceptions, scope/tree/source checks, budgets, and observed runner isolation/tool/usage enforcement. Only a visibly synthetic verifier exists in tests. No CLI approval or finalization path is connected. Serialized ballot objects never authorize effects.

For this initial host decision subset, review citations resolve to supplied check records. Repository, diff, and additional design evidence resolution and policy exceptions remain part of the prerequisite/evidence integration work. Plan scope validation is lexical and rejects grants overlapping protected ancestors; filesystem canonicalization and symlink race protection remain broker/workspace responsibilities. No security guarantee is inferred from these lexical checks.
