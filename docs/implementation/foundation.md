# First foundation slice

Status: implemented subset of M1/M2. Neither milestone nor M0 is complete.

Affected requirements: PRD Sections 3, 7, and 8; SYSTEM_DESIGN Sections 2.1, 4, 5.1, and 7. This slice creates the package and validates the initial contracts before any model-driven mutation.

Implemented:

- Strict TypeScript package, pinned lockfile, executable composition root, offline test/build/format/lint/size scripts, and explicit unavailable release-test commands.
- Runtime schemas and inferred types for repository configuration, session state, transition inputs, journal events, and errors. JSON Schema exports derive from those definitions.
- Pure transitions through preflight/planning/design/test specification/freeze/check completion, repair, blocking, cancellation, abort, and conservative resume. Approval and finalization remain unavailable.
- Per-stage/total repair limits, token ceiling reservations, active deadline accounting, and preservation of spent counters across backtracking and replay.
- Canonical serialization and SHA-256 with stable vectors; schema/sequence/identity/hash-link validation during supplied-event replay.
- Read-only `config` and initial `doctor` diagnostics with versioned JSON stdout, explicit exit codes, bounded configuration reads, leaf-symlink rejection, and escaped text diagnostics. Configured commands are never executed.

Acceptance evidence: 19 unit tests and 5 integration tests passed on Node.js 25.9.0. Tests exercise malformed/unknown fields, invalid transitions, ledger mismatch, exhaustion, reservations retained across cancellation, evidence identity invalidation, replay of serialized events after projection loss, corrupted/reordered/foreign events, built CLI JSON/help, configuration preservation, oversized inputs, symlinks, and secret-free error diagnostics. Format, lint, strict typecheck, size, build, and generated-schema consistency checks passed using `npm run check`.

The first verification attempt found redundant type guards after narrowing assertions and unawaited test registration promises; the test code was corrected and registrations are now awaited. A lint failure for nested configuration-read error handling was resolved by extracting cohesive bounded-read and JSON-parse helpers. No behavior test was weakened or skipped.

Not run: live runner/conformance probes, container checks, model evaluations, and real disk-crash/recovery fixtures. Their infrastructure is not implemented. The routine suite is offline and makes no model calls.

Pending: safe `init` and personas, remaining motion/candidate/invocation/check/review/ballot/receipt contracts, DAG validation, clock/ID boundary implementations, durable journal/artifacts, leases/locks, complete resume reconciliation, workspace isolation, broker, exact-tree candidates, evidence evaluation, finalization, and both runner adapters. Configuration validation is structural and cannot certify command safety, runtime capabilities, or an approval. No verified workflow is available.

Next cohesive slice: finish the remaining executable contract definitions and DAG validation, then add durable intent/completion journaling with fault injection and lock ownership verification before exposing session mutation commands.
