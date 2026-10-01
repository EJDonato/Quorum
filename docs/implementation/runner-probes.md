# Repeatable runner smoke probes

Status: probe tooling implemented; live structured-output results pending. M0 and enforced adapter support remain incomplete.

Affected requirements: PRD Sections 7 and 9; SYSTEM_DESIGN Section 5.2. This adds test tooling only, without implementing a production runner adapter or changing Quorum's configuration or approval contracts.

## Evidence and offline tests

Historical user-provided connectivity responses are preserved in `tests/fixtures/runners/`. Their provenance, token observations, Codex model-access failures, and limitations are recorded in [runner feasibility](../decisions/runner-feasibility.md).

`tests/probes/protocol.ts` defines one strict Zod response schema and derives the JSON Schema supplied to both CLIs. The synthetic structured-response fixtures used by offline tests are not live provider evidence. The host validates that the marker is `QUORUM_OK`, the sum is 5, and no extra response fields are present. Raw process completion cannot substitute for a valid response.

`tests/integration/runner-probe.test.ts` covers both envelopes, malformed and unexpected response fields, missing/negative usage, runner errors, incomplete/reordered/duplicate Codex completion, tool events, nonzero exit, timeout, output limits, cancellation, and missing executables. Real Node subprocess fixtures run offline; no installed agent CLI or model endpoint is invoked by `npm run check`.

Historical plain-text smoke responses intentionally fail the new structured-response validator. That is a new probe requirement, not a retroactive rejection of their connectivity result.

## Manual live probes

Run these from the Quorum repository. Node.js 24+ and installed dependencies are required. Each command builds, discovers the runner version, and launches one model invocation, with no harness retries. `--live`, an explicit model, and an absolute executable path are required. Use only a trusted local launcher.

Codex, using the model that passed the user's smoke test:

```sh
npm run probe:runners -- --live --runner codex --model gpt-6-sol --executable /Users/eltonjames/.local/bin/codex
```

For Antigravity, first identify the exact model configured for the successful smoke test or another accessible model. Replace `YOUR_AGY_MODEL` below before running; it is a placeholder, not a model name:

```sh
npm run probe:runners -- --live --runner agy --model YOUR_AGY_MODEL --executable /Users/eltonjames/.local/bin/agy
```

These commands consume provider usage using the runner's existing authentication/configuration. They run in a fresh temporary directory containing only the response schema; the repository is not their working directory. They do not provide a Quorum container/broker boundary. Existing user plugins/configuration may affect the request. Sandbox flags and no-tools prompts are not proof that tools cannot execute.

Each invocation has a 60-second host deadline and a combined 1 MiB stdout/stderr limit; version discovery has a 10-second deadline. The harness does not enforce a token or monetary ceiling. Observed context was approximately 16k Codex input tokens and 29k Antigravity input tokens, but these are not upper bounds. Provider-internal retries are not controlled or measured by the harness. Do not run these probes as enforced sessions.

The live schema requires `{ "marker": "QUORUM_OK", "sum": 5 }`. Codex output must contain one ordered completed turn and one final agent message; tool/unknown events fail. Antigravity output must contain `status: SUCCESS`, a JSON string in `response`, and reported usage. An unfamiliar envelope fails explicitly; investigate actual version-specific behavior before changing the parser. Codex's flags are documented in [official OpenAI documentation](https://learn.chatgpt.com/docs/non-interactive-mode); Antigravity flags came from locally observed 1.2.14 help, and their runtime behavior remains unproven.

A versioned report is written as a new private `report.json` in the temporary directory. The path is printed on stderr. It records discovered version, requested model, timestamp, exit status, failure category, validated response, and known numeric usage fields. The requested model is not attested as the actual backend model. Unknown usage fields are not counted. Raw stdout/stderr and credentials are not saved or echoed. Reports are retained for inspection, including failures; temporary directories are not automatically deleted.

Exit 0 means this structured smoke probe passed; exit 1 means failure. SIGINT/SIGTERM attempts to kill the direct runner's POSIX process group and records incomplete execution. Descendants can escape that group; cleanup is always marked unconfirmed. The report always states `enforced_conformance: false`. A failed first attempt must be retained and investigated; do not hide it by rerunning until green.

## Verification and next assignment

`npm run check` passed: formatting, lint, strict typecheck, size, build, 19 unit tests, 12 integration tests (7 new probe tests), and generated-schema consistency. `git diff --check` passed. The initial lint attempt identified excessive nesting in Codex event parsing; extracting item-message validation resolved it without weakening tests. No live model calls were made. Container escapes, hard token ceilings, complete usage semantics, credential separation, and descendant-cleanup conformance remain untested.

Next assignment for the implementer: identify the Antigravity model, run bounded schema probes when live usage is authorized, preserve reports including failures, and investigate broker-only tool control and hard token ceilings for each pinned runner. Only observed capabilities may change the feasibility table. Keep M0 blocked until all mandatory capabilities are proven or product scope is explicitly revised. Full `test:conformance` remains unavailable.
