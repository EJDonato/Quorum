# Workspace and broker implementation

**Status: partial M3 infrastructure with offline tests; enforced agent isolation is unavailable.** This report supersedes the earlier complete-safety claims.

Workspaces use private Git metadata and a committed source base. Fixture tests verify that draft edits leave the source files and index intact. Directory creation rejects linked components and invalid session IDs. This is host infrastructure for testing; it is not a sandbox for executing repository or model code.

Broker reads require explicit granted paths, deny reserved metadata, open regular files without following links, and recheck path and descriptor identity before returning bounded data. Search is a literal text search over granted files. Explicit search paths cannot expand grants or inject Git pathspecs; discovery rejects links and has a file-count bound. Protected paths restrict writes and can still be read when granted.

Patch operations enforce role/phase permissions, protected paths, and draft digests. Production patch isolation and adversarial concurrent-writer guarantees still require a sandbox and frozen snapshots. Role submission and artifact access are preliminary storage handlers; they are not a complete authenticated invocation protocol.

`checks.run` blocks with `CAPABILITY_MISSING` unless a host-bound validation port is present. The [configured validation executor](configured-validation.md) now runs final-candidate checks in disposable Docker containers and publishes host-authored evidence. The previous fabricated `PASSED` implementation remains removed. Baseline/expected-red execution and authenticated production invocation grants are still pending.

Cleanup acquires the command lock, reads the actual repository lease, validates session ownership metadata and unlinked paths, and quarantines the draft by rename before deletion. It checks the moved directory identity and preserves suspicious content. A caller-provided lease status cannot authorize deletion. A live command owner remains locked after TTL expiry.

Tests cover actual active leases, forged ownership, traversal, linked drafts, source preservation, scoped reads/searches, immutable artifact substitution, and missing check execution. [The enforcement correction report](enforcement-corrections.md) records remaining blockers and verification.
