# Offline workflow and finalization

**Status: implemented offline test slice; M4 is not production complete.** The enforcement correction report supersedes the earlier completion claims in this document.

The application workflow requires all five stage handlers plus trusted host preflight, frozen input identity, artifact reads, and prerequisite verification. Missing gates block before workspace creation. Checks and final QA/security reviews are validated against the candidate and their recorded invocation identities through `evaluateBallot`. Successful stage callbacks alone cannot approve a candidate. Tests inject explicitly fake evidence and adapter identities from `tests/fixtures/workflow.ts`; these ports never establish real runner or container capabilities.

`runSession` stops at `APPROVED` by default. Its explicit `commit: true` option authorizes private finalization. The CLI workflow and commit handlers remain unavailable.

Finalization recomputes the ballot, checks source HEAD and the current draft tree, and persists a versioned immutable intent containing the transaction, candidate, tree, parent, evidence, message, author/committer identity, and timestamp. It recreates the same commit from saved metadata, verifies the tree and single parent, records the commit object identity, and creates the private branch with compare-and-swap. A conflicting branch is preserved. A saved receipt must match the transaction and Git objects; a missing branch or malformed record blocks recovery. Evidence, source, and tree are rechecked before the ref update and receipt publication.

`tests/integration/finalization-safety.test.ts` interrupts finalization after intent persistence, object recording, and reference installation. Restarts retain the transaction and timestamp and produce one identical commit. It also covers missing gates, changed evidence, unreviewed edits, conflicting branches, corrupt records, substituted receipt parents, source divergence, and explicit commit authorization. Existing offline change, bounded repair, source preservation, and receipt replay tests remain enabled.

Remaining work includes production prerequisite verification, authenticated role invocation/submission, protected test-change workflows, budget charging across actual effects, full workflow resume/cancellation reconciliation, and CLI wiring. [Configured final-candidate validation](configured-validation.md) now has a real Docker boundary with separate fixtures, but the offline workflow's fake-role tests do not establish release conformance.

See [the enforcement correction report](enforcement-corrections.md) for the historical correction and [the validation report](configured-validation.md) for the executor slice and [the test-preparation report](test-preparation.md) for current verification and the next assignment.

Follow-up: the orchestrator now requires complete host-verified [test-preparation evidence](test-preparation.md) before entering implementation. Successful QA author callbacks alone are insufficient.
