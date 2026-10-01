# Repeatable runner smoke probes

Status: one authorized live schema probe per runner retained on 2026-10-01. Codex 0.159.3 passed; Antigravity 1.2.14 failed protocol validation. **M0 is BLOCKED**, enforced support is unproven, and full `test:conformance` remains unavailable.

Affected requirements: PRD Sections 7 and 9; SYSTEM_DESIGN Section 5.2. This adds test tooling only, without implementing a production runner adapter or changing Quorum's configuration or approval contracts.

## Evidence and offline tests

Historical user-provided connectivity responses are preserved in `tests/fixtures/runners/`. Their provenance, token observations, Codex model-access failures, and limitations are recorded in [runner feasibility](../decisions/runner-feasibility.md).

`tests/probes/protocol.ts` defines one strict Zod response schema and derives the JSON Schema supplied to both CLIs. The synthetic structured-response fixtures used by offline tests are not live provider evidence. The host validates that the marker is `QUORUM_OK`, the sum is 5, and no extra response fields are present. Raw process completion cannot substitute for a valid response.

`tests/integration/runner-probe.test.ts` covers both envelopes, malformed and unexpected response fields, missing/negative usage, runner errors, incomplete/reordered/duplicate Codex completion, tool events, nonzero exit, timeout, output limits, cancellation, and missing executables. Real Node subprocess fixtures run offline; no installed agent CLI or model endpoint is invoked by `npm run check`.

Historical plain-text smoke responses intentionally fail the new structured-response validator. That is a new probe requirement, not a retroactive rejection of their connectivity result.

## Manual live probes

Run these from the Quorum repository only with authorization for a new live attempt. Node.js 24+ and installed dependencies are required. Each command builds, records an intent, resolves and hashes the executable, checks its observed version against `--expected-version`, and schedules at most one runner invocation, with no harness retries. `--live`, an explicit model, an expected version, and an absolute executable path are required. Use only a trusted local launcher. Version mismatch or binary change blocks before the model request and produces a failed report. These guards do not replace container isolation or defend against a hostile host swapping an executable after the check.

Codex, using the model that passed the user's smoke test:

```sh
npm run probe:runners -- --live --runner codex --model gpt-6-sol --executable /Users/eltonjames/.local/bin/codex --expected-version 0.159.3
```

For Antigravity, the current configured label and catalog identify `gemini-3.8-flash-medium`. The historical plain-text smoke model remains unknown:

```sh
npm run probe:runners -- --live --runner agy --model gemini-3.8-flash-medium --executable /Users/eltonjames/.local/bin/agy --expected-version 1.2.14
```

These commands consume provider usage using the runner's existing authentication/configuration. They run in a fresh temporary directory containing only the response schema; the repository is not their working directory. They do not provide a Quorum container/broker boundary. Existing user plugins/configuration may affect the request. Sandbox flags and no-tools prompts are not proof that tools cannot execute.

Each invocation has a 60-second host deadline and a combined 1 MiB stdout/stderr limit; version discovery has a 10-second deadline. The harness does not enforce a token or monetary ceiling. Observed context was approximately 16k Codex input tokens and 29k Antigravity input tokens, but these are not upper bounds. Provider-internal retries are not controlled or measured by the harness. Do not run these probes as enforced sessions.

The live schema requires `{ "marker": "QUORUM_OK", "sum": 5 }`. Codex output must contain one ordered completed turn and one final agent message; tool/unknown events fail. Antigravity output must contain `status: SUCCESS`, a string `response`, a strict schema-valid object in `structured_output`, and reported usage. Free text cannot replace missing/invalid structured data. An unfamiliar envelope fails explicitly; investigate actual version-specific behavior before changing the parser. Codex's flags are documented in [official OpenAI documentation](https://learn.chatgpt.com/docs/non-interactive-mode); Antigravity flags came from locally observed 1.2.14 help, and their runtime behavior remains unproven.

A private `intent.json` is written before runner effects, then a versioned result is saved as a new private `report.json`, including version-discovery, missing-executable, mismatch, cancellation, and model/protocol failures. The path is printed on stderr before dispatch. Use `--report-dir /absolute/existing/directory` to retain each uniquely named private directory under a chosen parent; the default is the system temporary directory. Reports record expected/discovered version, binary digest, requested model, timestamp, attempt count, exit status, fixed diagnostic categories, validated response, and known numeric usage fields when validation succeeds. No passing evidence is emitted if report persistence fails; an intent-only interrupted directory is incomplete, not approval.

The requested model is not attested as the actual backend model. Unknown usage fields are not counted. Raw stdout/stderr are bounded in memory and discarded; credentials and provider diagnostics are not echoed or saved. Consequently, a generic protocol failure may not reveal the exact failing field or usable accounting. Reports explicitly mark hard ceilings, complete accounting, enforced conformance, and cleanup as unproven. Temporary directories are not automatically deleted; permanent sanitized copies of the two authorized live attempts and their intents are retained in [evidence/2026-10-01](evidence/2026-10-01/). Evidence copies are excluded from automatic formatting so historical records are preserved.

Exit 0 means this structured smoke probe passed; exit 1 means failure. SIGINT/SIGTERM attempts to kill the direct runner's POSIX process group and records incomplete execution. Descendants can escape that group; cleanup is always marked unconfirmed. The report always states `enforced_conformance: false`. A failed first attempt must be retained and investigated; do not hide it by rerunning until green.

## Authorized live observations

The user permitted one schema probe per runner after being told the deadline/output bounds and lack of a hard token/cost ceiling. Both were run outside the host sandbox because the CLIs require existing authentication, network/local listeners, and runtime log writes. This permission is not Quorum enforcement, and it does not authorize additional model attempts.

- [Codex 0.159.3 report](evidence/2026-10-01/codex-0.159.3-schema-report.json): requested `gpt-6-sol`, exit 0, validated response, 16,144 input and 22 output tokens. One success demonstrates only the narrow schema smoke.
- [Antigravity 1.2.14 failed report](evidence/2026-10-01/agy-1.2.14-schema-failed-report.json): requested `gemini-3.8-flash-medium`, exit 0, `INVALID_PROTOCOL`. Exact failing output/usage is unavailable because raw capture was discarded. No retry was made and the parser was not weakened.

Both reports preserve expected version and executable digest. They predate the separate `version_exit_code` field now emitted by the harness; historical reports were not rewritten. The [feasibility table](../decisions/runner-feasibility.md) reflects only these observations and leaves mandatory enforcement gates unverified. The [control investigation](runner-controls.md) records observed flag/schema behavior and documented leads separately.

## Verification and remaining work

`npm run check` passed: formatting, lint, strict typecheck, size, build, 19 unit tests, 16 integration tests, and generated-schema consistency. New synthetic tests cover mismatch rejection before dispatch, missing executables, binary changes, secret-free diagnostic categories, success/failure metadata, and preserved private intent/results when discovery fails. No installed model runner is invoked by the offline suite. The report helper's initial lint failure for an untyped stream chunk was corrected by narrowing it from `unknown` to `Buffer`; no test was weakened. `git diff --check` passed.

Remaining work: obtain authorization before another instrumented Antigravity request, diagnose the protocol mismatch without hiding this failure, prove exact effective broker-only tool exposure, and enforce/verify hard token ceilings and complete accounting for each pinned integration. Container escapes, credentials/network separation, descendant termination/recovery, and full conformance remain untested. Only observed capabilities may change the feasibility table. Keep M0 blocked until every mandatory capability is proven or product scope is explicitly revised.

## Instrumented diagnosis and parser correction

A separately approved, single instrumented Antigravity 1.2.14 attempt is retained in [the diagnostic report](evidence/2026-10-01/agy-1.2.14-instrumented-failed-report.json) and its intent. The same model was requested, with the same 60-second/1 MiB limits and no retry. It exited 0 in 16,347 ms of host-measured invocation time but failed at `response_json` with `MALFORMED_JSON`. Safe envelope types show `response: string`, `structured_output: object`, and `usage: object`. Contents and usage were not retained on failure. This establishes the failing parser stage, not correctness of the structured response.

The [official Antigravity headless contract](https://www.antigravity.google/docs/cli/headless/) identifies `structured_output` as the parsed schema output and recommends reading it. The probe now validates that object directly, requires successful status and usage, and refuses to fall back to free text. The earlier parser assumption was an implementation defect. Synthetic regression tests cover free text alongside valid structured data and rejection of missing/null/invalid/extra-field structured responses. This change is grounded in the documented transport contract; it does not relax the response schema or reinterpret retained failures as successes. No second model call was made after the correction.

Probe report schema 1.1.0 adds fixed failure stages, sanitized known-field names/types, and host version-discovery/invocation/total timings. Old reports remain byte-for-byte unchanged. The corrected parser still needs a newly authorized live verification before Antigravity's schema capability can be upgraded. [Early friction checkpoints](friction-checkpoints.md) define the remaining broker/ceiling experiments and container/workflow measurements.
