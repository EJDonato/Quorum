# Structured validation reports and disposable snapshots

Status: implemented for frozen final-candidate checks.

Use a versioned strict `ValidationReport` supplied by an explicitly configured tool wrapper. The host owns process status, execution identity, frozen input digests, stream references, and `CheckResult` publication. A zero exit without a complete valid report cannot establish discovery, scanner completeness, or fuzz completion. Native tool parsers remain deferred; silently treating arbitrary stdout as success would weaken the check contract.

Require a local digest-pinned Linux image, verify the created container profile, and reconstruct the exact Git tree into a disposable read-only bind mount. Mutable drafts, user Git metadata, host dependency directories, credentials, and runtime sockets are excluded. Provision dependencies ahead of time; this slice has no online installation or shared writable cache. Repository links, submodules, LFS pointers, and filesystem name collisions block rather than being partially copied. This conservative restriction can be expanded only with explicit snapshot contracts and negative isolation fixtures.

Keep the original intent immutable if remaining time shrinks between authorization and dispatch. Pass the shorter deadline separately. Cleanup is supervised outside the cancelled process signal and uses bounded Docker commands; setup and cleanup can add time beyond the attached check deadline. Unknown cleanup preserves work and blocks evidence. Recovery confirms complete intent/ownership and container absence, never infers success from an interrupted result or automatically replays work.

This executor establishes a selected validation boundary, not an authenticated runner integration or a complete enforced workflow. Baseline/expected-red scheduling, production budget/effect journaling, and runner capability conformance must supply their own evidence.
