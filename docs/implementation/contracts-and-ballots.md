# Contracts and host ballot slice

Status: implemented foundation subset. M0 remains blocked; the project and milestones are incomplete.

Affected requirements: PRD approval, evidence, budget and advisory invariants; SYSTEM_DESIGN Sections 4, 5, and 7. This slice finishes executable inventory records before durable workspace or role effects are connected.

Implemented:

- Strict versioned motion, candidate, invocation request/result, check, review body/result, ballot requirements/result, and commit receipt schemas with inferred TypeScript types and generated JSON Schemas.
- Deterministic DAG ordering, reference/criterion ownership checks, and lexical scope/protected-path rejection.
- Canonical candidate identity creation and verification across frozen dependencies, including Git object formats and runner/model/persona versions.
- Check passing and expected-red classification; complete conservative usage and invocation identity/reservation validation.
- Host-only artifact loading, raw digest verification, review/request/invocation binding, and fresh ballot evaluation with explicit negative reasons. No model or CLI tool exposes this API.

The synthetic artifact and prerequisite ports in tests establish code behavior only. They cannot establish production capability, approve a real session, or qualify either runner. Existing probe reports, including failures, remain preserved; no additional live probes were run for this slice. The feasibility table is unchanged.

Verification: `npm run check` passed on Node.js 25.9.0: formatting, lint, strict typecheck, size, build, 27 unit tests, 30 integration tests, and generated-schema consistency. No tests were skipped. `git diff --check` also passed. Tests cover cycles, scope escapes, identity tampering, incomplete checks, zero discovery, partial fuzz runs, false red infrastructure failures, malformed review authority, advisory mode, absent prerequisite proof, artifact substitution, stale policy/command/environment/candidate bindings, design approval substitution, output swaps, usage overruns, duplicate reviewers, rejection, and dangling citations.

Initial verification found test fixture promise/literal typing errors; those were corrected without weakening behavior assertions.

Not run: live probes, conformance, container enforcement checks, disk-crash recovery, or model evaluations. These remain outside the implemented slice or unavailable.

Remaining: durable journal/artifact storage, repository locks/leases, crash reconciliation, safe workspace and filesystem boundaries, broker authorization, complete policy/acceptance evidence integration, exact-tree freezing, finalization transactions, real runner adapters, and model evaluations. `test:conformance` remains unavailable. Schema parsing a receipt does not verify a commit.

Next cohesive slice: durable intent/completion journaling and bounded artifact storage with fault-injection recovery and lock ownership tests, before exposing mutable CLI workflow commands. See [the evidence contract decision](../decisions/evidence-contracts.md) for current integration limits.
