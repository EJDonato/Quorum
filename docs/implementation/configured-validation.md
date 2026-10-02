# Configured validation executor

Status: implemented final-candidate validation slice, verified on 2026-10-02. M3/M4 remain partial; Antigravity and Codex enforced integrations remain blocked.

The host now runs configured checks through `src/application/run-check.ts` and `src/infrastructure/validation/`. `src/broker/checks.ts` binds `checks.run` to the host session, invocation, granted check IDs, and current candidate revision. Role inputs cannot supply commands, environment values, Docker paths, or artifact identities. The existing broker role/phase checks still apply.

Before execution, the host validates the frozen configuration, candidate identity, command and environment digests, and remaining time. It persists an immutable `ValidationIntent`. A second authorization may shorten the dispatch deadline without changing that saved intent. The host reconstructs the recorded Git tree into a disposable directory instead of mounting the mutable draft or source checkout. Links, submodules, LFS pointers, Git metadata, unsafe paths, case/Unicode collisions, and oversized snapshots block this implementation.

The local Linux Docker profile requires an already cached digest-pinned image, with no implicit image volumes. Creation uses explicit executable/argument arrays and `--pull=never`; the host inspects the created container before starting it. The profile has one read-only candidate bind mount at `/workspace`, a read-only root, no external network, non-root UID/GID 65534, dropped capabilities, no new privileges, private process/cgroup namespaces, an init process, and bounded CPU, memory, process count, and output. `/tmp` and `/scratch` are separate disposable 64 MiB tmpfs mounts. No source checkout, host Git metadata, artifact store, or runtime socket is mounted.

Host environment variables are not inherited by the check. Image environment values are cleared; fixed PATH/HOME/TMPDIR and explicit permitted non-secret values are supplied through a private supervisor environment file, not process arguments. Loader overrides and credential-like key names are rejected. The file is not mounted into the container. Persisted diagnostics escape terminal control characters and redact supplied environment values; this is not a guarantee that arbitrary repository/tool output contains no secrets.

Process completion is separate from passing evidence. The host writes `CheckResult` with the real exit status, frozen identities, measured duration, and hashes of the persisted diagnostic streams. Empty or malformed reports, zero discovered tests, failed startup, missing executables, mismatched fuzz seeds/counts, timeout, cancellation, or overflow cannot pass. Interrupted capture discards partial output. Cleanup must verify the execution ownership label, stop/remove the container, and confirm absence before evidence publication. Unconfirmed cleanup preserves scratch work and blocks approval. Host-only recovery compares the complete saved intent with scratch ownership, confirms container removal, records cleanup, and requires a fresh invocation; it never replays an interrupted check.

## Configuration and reporting contract

Every executable check needs `report_format: "quorum-json-v1"`. A fuzz command also needs frozen `fuzz: {seed, cases_required}`. Existing configurations still parse without these optional fields, but execution blocks when the required reporting capability is missing. Configuration or environment changes require a new candidate identity and invalidate old evidence.

An example command entry is:

```json
{
  "check_id": "unit",
  "kind": "test",
  "executable": "node",
  "args": ["scripts/quorum-test-report.mjs"],
  "report_format": "quorum-json-v1"
}
```

The script path is illustrative; no generic wrapper is provided. A configured wrapper must actually run its tool, preserve its failing exit status, and emit exactly one JSON object on stdout matching [ValidationReport](../../schemas/ValidationReport.json). Tool diagnostics belong on stderr. For example, a successful test report is:

```json
{
  "schema_version": "1.0.0",
  "report_complete": true,
  "discovered_tests": 1,
  "error_count": 0,
  "warning_count": 0,
  "failure_class": null,
  "tool_version": "fixture-tool-1",
  "fuzz": null
}
```

This example is a contract illustration, not test evidence. Plain `npm test`, TAP text, or an exit code alone is insufficient. No native test/lint/scanner output parsers, dependency installer, writable shared cache, or host `node_modules` copying were added. Required Linux dependencies must already be in the provisioned image or frozen tree. Checks must use read-only inputs and place writable output in `/scratch` or `/tmp`.

## Repeatable verification

`npm run check` remains offline and includes deterministic fake-Docker integration fixtures with real temporary Git repositories. They cover evidence identity/hash binding, dirty source preservation, stale and unauthorized broker requests, malformed reports, missing images, failed creation, timeout/overflow, unsafe daemon metadata, cleanup uncertainty, interrupted recovery, tampered ownership, persisted-intent failure, invalid budgets, and snapshot exclusions. Fake fixtures cannot establish Docker isolation.

Final verification passed: formatting, lint, strict typecheck, size, build, generated-schema comparison, **37 unit tests and 98 integration tests**, with zero failures or skips. No model calls, full adapter conformance, or task benchmarks were run.

The separate live command requires an explicitly selected local image and Unix socket:

```sh
npm run test:validation:container -- --image 'IMAGE@sha256:DIGEST' --socket '/absolute/path/to/docker.sock'
```

Replace both placeholders. An optional `--docker /absolute/path/to/docker` selects the executable; the default is `/usr/local/bin/docker`. The command never pulls an image, installs dependencies, or invokes a model.

Six real fixtures passed with zero skips against Docker 29.6.2, Linux arm64, using the already cached image `public.ecr.aws/supabase/studio@sha256:06c541e63395ff1a06150189edd598ed393fd81ae09059ae7558d3220311c49f`: candidate/root write denial and host environment/network exclusions with dirty-index preservation; detached descendants; a stubborn process deadline; output overflow; missing executable; explicit cancellation. No owned check containers remained afterward. This image was a test fixture, not a recommended validation image or universal portability claim.

Initial live verification exposed omitted `Config.Volumes` metadata and exit-127 startup classification. Both were corrected with offline regressions before the successful suite. These runs do not establish runner conformance, comprehensive hostile-code isolation, production task performance, or the PRD benchmark.

## Remaining work and next assignment

Follow-up: [baseline and expected-red preparation](test-preparation.md) extends this executor to immutable preparation snapshots and implements host QA scheduling and the pre-implementation evidence gate. The six fixtures and 37/98 routine counts above describe this initial executor slice; the follow-up report records current verification.

Production durable budget charging, authenticated invocation grants, protected test revisions, workflow reconciliation, and Antigravity/Codex enforced conformance remain pending. CLI readiness and `doctor` were not upgraded to production capabilities. The next assignment is durable effect/budget integration as specified in the follow-up report.
