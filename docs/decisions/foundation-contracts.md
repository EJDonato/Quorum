# Foundation contracts and tooling

Status: implemented for the first foundation slice; M1 is incomplete.

Use Zod 4.6.5 as the only runtime dependency. It supplies strict boundary validation, inferred TypeScript types, and [native JSON Schema generation](https://zod.dev/json-schema) from the same definitions. Generated schemas express structural constraints; cross-field refinements such as matching repair totals still require the runtime parser. They do not confer authorization.

Use Node's built-in argument parser and test runner. Pin TypeScript 5.9.3 because typescript-eslint 8.71.0 declares TypeScript support below 6.1.0; the registry's newer TypeScript version does not fit that constraint. ESLint 10.11.0 and Prettier 3.9.9 are development dependencies. The lockfile records the actual installed tree. No runner SDK or orchestration framework is included.

Canonical serialization version 1 is a Quorum JSON convention, not a claim of RFC 8785 compliance. It recursively sorts object keys using JavaScript UTF-16 ordering, retains array order, uses JSON string/finite-number encoding, maps negative zero to zero, and preserves Unicode without normalization. Reject unsupported values, nonplain objects, accessors, hidden/symbol fields, sparse/extended arrays, cycles, and nesting of 100 containers or more. UTF-8 SHA-256 digests include an algorithm prefix. Changing this convention requires a contract version change and invalidates existing identities.

Configuration paths currently describe literal relative paths. They are structurally validated but are not effective grants. Canonical filesystem resolution, protected-path intersection, and effect-boundary rechecks belong to the future broker/workspace implementation.

The reducer accepts host events through review collection only. It cannot approve or finalize; those events are deliberately absent until complete evidence contracts and ballot/finalization use cases exist. Recorded preflight/check completion events are trusted host statements, not proof of a production check. No CLI command emits these events yet. Resume conservatively restarts planning, clears the candidate, preserves spent counters, and rejects exhausted allowances; optimized stage selection and explicit budget increases are pending.

Replay starts from a sequence-zero session supplied by the host and checks contiguous sequence, session identity, unique event IDs, schemas, transition legality, and previous-event digest links. A hash chain detects linked-record corruption; it does not authenticate a hostile host or independently authenticate the final event. Filesystem journal framing, tail reconciliation, durable writes, intent/completion records, and effect reconciliation are pending. The current replay test discards a projection and rebuilds it from serialized events; it is not a disk-crash durability test.
