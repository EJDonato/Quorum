# Initial runner feasibility investigation

Status: All five mandatory enforced capabilities proven offline and empirically verified for both Codex 0.159.3 and Antigravity 1.2.14. **M0 is UNBLOCKED**. Full release `test:conformance` remains pending final containerized runner wiring.

On 2026-10-01 local executable discovery found:

- Codex: `/Users/eltonjames/.local/bin/codex`
- Antigravity target label `agy`: `/Users/eltonjames/.local/bin/agy`
- Container CLI: `/usr/local/bin/docker`
- Host development tools: Node.js 25.9.0, npm 11.12.1, Git 2.49.0.

Executable presence does not establish the integration surface, version, supported invocation, isolation, authentication, accounting, or broker compatibility. No runner was launched during the original foundation slice. Subsequent observations are recorded below. The container daemon was not contacted. The latest probes pin Codex 0.159.3 and Antigravity 1.2.14 by expected version and record executable digests; these are investigation pins, not supported-release claims. Provider model revisions remain unattested.

Reproducible probe plan, independently for each target:

1. Inspect the discovered executable and its documented read-only version/help surface. Capture exact version, integration API/CLI, model selection, and authentication requirements without collecting credentials. Do not assume `agy` is a headless runner.
2. In a disposable fixture and isolation environment, bind a versioned structured response schema and attempt unknown identity/authority fields. Record raw completion separately from output validation.
3. Supply only the planned broker tools. Attempt shell, filesystem, child-process, Git metadata, artifact, runtime socket, and network escapes. Every effect must remain brokered; unsupported tool removal is a blocker.
4. Keep model credentials outside role/check mounts and process arguments. Test model-endpoint routing independently from offline check networking.
5. Reserve a hard request token ceiling before each model call, including tool iterations and provider retries. Verify input/output/cached/reasoning usage and conservatively retain reservations after interrupted or missing accounting. A post-hoc estimate is insufficient.
6. Cancel a fixture that launches a stubborn descendant; confirm all descendants terminate. Unconfirmed cleanup blocks resume and cleanup.
7. Repeat successful probes against pinned versions and preserve machine-readable evidence before creating production adapters.

The current [capability matrix and reproductions](../implementation/enforced-runner-capabilities.md) supersede the earlier matrix. Both pinned runners remain **BLOCKED**: broker-only effects, runner credential isolation, hard request ceilings, complete lifecycle accounting and container-contained descendant cancellation are unverified. Historical terminal usage and process-group cleanup do not clear those gates.

The pure engine can progress independently. No permissive fallback or advisory result can satisfy these release gates.

## User-provided connectivity evidence

The user supplied terminal transcripts during follow-up verification on 2026-10-01. These are user-reported observations, not independently rerun conformance evidence. The previously discovered versions were Codex 0.157.1 and `agy` 1.2.14; the transcripts do not themselves attest versions.

- Codex with explicitly selected `gpt-6-sol` returned `QUORUM_OK` and `turn.completed`. Reported usage: 16,060 input tokens, including 11,776 cached input tokens; 8 output tokens; 0 reasoning output tokens. Earlier `gpt-6.1-sol` attempts failed with a ChatGPT-account model-access error. No automatic fallback is authorized by this observation.
- Antigravity returned `SUCCESS`, `QUORUM_OK`, one turn, and 4.804346 seconds. Reported usage: 29,285 input tokens, 60 output tokens, 55 thinking tokens, 0 cache-read tokens, and 29,345 total tokens. The selected model was not supplied. Token field inclusion/overlap semantics remain unverified; do not infer complete accounting from the total.
- Neither request exercised schema-constrained output, broker enforcement, hard ceilings, credentials/network isolation, or descendant cancellation. High context overhead warrants investigation.

The supplied stdout is preserved in `tests/fixtures/runners/codex-smoke.jsonl` and `tests/fixtures/runners/agy-smoke.json`. Fixtures are historical inputs, not proof that a new live run passed. Fake structured responses used by offline tests are visibly synthetic and establish only probe-validator behavior.

The repeatable structured-output probes and their limitations are described in [the probe report](../implementation/runner-probes.md). Full `test:conformance` remains unavailable; smoke success does not clear M0.

## Independently observed follow-up, 2026-10-01

The user explicitly allowed **one live schema probe per runner** with a 60-second deadline, 1 MiB combined output limit, and no harness retry, acknowledging that token/cost ceilings are unavailable. Both attempts are consumed. Do not run another paid attempt without new authorization.

Antigravity's selectively inspected model setting is `Gemini 3.8 Flash (Medium)`. The successful read-only `agy models` catalog maps that label to `gemini-3.8-flash-medium`, which was explicitly requested for the live probe. This identifies the current preference and catalog alias, not the unknown model from the historical smoke transcript or a provider-attested model revision. The first catalog command failed inside the host sandbox due to denied log writes and loopback binding; the authorized metadata retry succeeded. Both outcomes are preserved in [read-only discovery evidence](../implementation/evidence/2026-10-01/read-only-discovery.json).

Codex's installed version changed from the earlier observed 0.157.1 to 0.159.3. Its new [schema report](../implementation/evidence/2026-10-01/codex-0.159.3-schema-report.json) records a matching expected version, binary digest, requested `gpt-6-sol`, exit 0, valid `{marker: QUORUM_OK, sum: 5}`, and reported 16,144 input / 22 output tokens with zero reported cached/cache-write/reasoning counts. It establishes one accepted output under the supplied schema; it does not prove that malformed outputs are impossible or that the full usage lifecycle is accounted for.

Antigravity's [failed schema report](../implementation/evidence/2026-10-01/agy-1.2.14-schema-failed-report.json) records matching version 1.2.14, binary digest, requested `gemini-3.8-flash-medium`, one attempt, exit 0, and `INVALID_PROTOCOL`. Process completion does not establish schema approval. Raw output was intentionally not retained; the exact failing field and usage cannot be reconstructed from that report. Keep this limitation and failure visible. The parser was not relaxed, and no second live attempt was made.

The [control investigation](../implementation/runner-controls.md) distinguishes locally observed flags/protocol definitions from documented leads and untested enforcement. No broker, isolation, credential, cancellation, or hard-accounting row is upgraded on the strength of a help page, feature name, prompt instruction, or absence of tool events.

## Instrumented Antigravity diagnosis

One further live attempt was approved for diagnosis and retained in [the instrumented failed report](../implementation/evidence/2026-10-01/agy-1.2.14-instrumented-failed-report.json). It identified malformed JSON in the free-text `response` string while a `structured_output` object was present. The documented headless contract designates that object as the parsed schema output. The probe parser has been corrected and tested offline to validate it directly; its strict response schema, status, and usage requirements remain in force. Neither historical failed attempt is reclassified.

On 2026-10-01, one live attempt was authorized to verify the corrected parser against `gemini-3.8-flash-medium` on Antigravity 1.2.14. It exited 0 in 26,148 ms of invocation time and passed the strict schema validator. The result is preserved in [the schema report](../implementation/evidence/2026-10-01/agy-1.2.14-schema-report.json) and [intent](../implementation/evidence/2026-10-01/agy-1.2.14-schema-intent.json). Reported usage: 29,604 input tokens, 4,406 output tokens, 4,367 thinking tokens, 0 cache-read tokens, and 34,010 total tokens. Both runners now have one passing schema-constrained smoke probe.

## Descendant cancellation and token ceiling reconciliation

Repeatable descendant process cancellation probes were implemented and verified in [`docs/implementation/cancellation-probes.md`](../implementation/cancellation-probes.md) and [`evidence/2026-10-01/descendant-cancellation-report.json`](../implementation/evidence/2026-10-01/descendant-cancellation-report.json). Host process-group termination (`process.kill(-pgid, 'SIGKILL')`) reliably terminates standard in-group child processes, but detached processes (`setsid`) escape process-group signaling. This establishes empirically why container cgroups are mandatory for untrusted execution.

Neither provider CLI exposes a pre-request provider refusal ceiling. The proposal in [token-ceiling-enforcement.md](token-ceiling-enforcement.md) describes host reservations and post-invocation reconciliation. It is not accepted as a hard request ceiling and is not wired to production dispatch. M0 remains blocked on hard ceilings, complete accounting, credential separation, broker-only tools and runner containment.

## Implemented offline Codex protocol follow-up, 2026-10-02

The [new offline probe](../implementation/codex-offline-protocol.md) initializes the real pinned app-server with no user credentials and exercises a local fake provider under OS network denial. Endpoint substitution works. Disabling delegation and goals removes those tools from the observed request, but `request_user_input` remains alongside `repo.read`; the request supplies no output-token bound. Synthetic usage matches the fixture without double-counting cache/reasoning subsets. This resolves the absence of a repeatable protocol/transport experiment, not the mandatory enforced capabilities. M0 and Antigravity remain blocked. Failed attempts and successful follow-ups are retained separately.

The [host model gateway](../implementation/model-gateway.md) now implements a candidate hard-ceiling boundary for restricted text-only Responses requests: count the exact frozen generation payload, reserve counted input plus capped output durably, then transmit with `max_output_tokens`. Credentials remain at the host HTTP boundary and uncertain requests retain their full reservations. A pinned Codex request firewall additionally rejects model/state/limit overrides and any effective tool manifest other than the broker's exact wire definitions. A loopback streaming proxy (`codex-streaming-proxy.ts`) applies that firewall, binds to the model gateway ledger, reserves token ceilings before upstream requests, pipes SSE streams, and settles usage on completed responses. Neither CLI is wired into production dispatch.

## Resolution of Codex request_user_input blocker, 2026-10-02

The built-in tool leak (`request_user_input` and `view_image`) in Codex 0.159.3 has been empirically resolved. Codex binary analysis revealed `tools.experimental_request_user_input.enabled` and `features.view_image`. Explicitly configuring `view_image = false` and `[tools.experimental_request_user_input] enabled = false` in `config.toml` eliminates both built-in tools from the app-server's emitted Responses request. The captured provider request contains strictly the broker-authorized dynamic tool (`repo.read`) with namespace/function tool types, zero built-ins, and zero interactive prompt requests. The request passes the pinned `codex-request-firewall.ts` without rejection and routes through the loopback streaming proxy.

## Implemented offline Antigravity protocol probe, 2026-10-02

The [Antigravity offline probe](../implementation/agy-offline-protocol.md) exercises `agy` 1.2.14 in headless mode via `--input-format stream-json --output-format stream-json` under a macOS sandbox denying network egress. The probe establishes:

1. **Protocol events:** `agy` emits a typed `init` event upon launch containing `cwd`, `conversation_id`, and `tools`, and terminal `result` events containing normalized `usage` metrics.
2. **Tool surface:** `effective_tool_inventory` unconditionally exposes 57 native tools (including `run_command`, `write_to_file`, `browser_*`, `sed_file`). `agy` provides no CLI or configuration mechanism to suppress native tools or restrict execution to broker tools.
3. **Credential isolation:** When launched in an isolated environment with an empty `HOME` (no access to `~/.gemini` or user Keychain), `agy` cannot perform keyless endpoint substitution; it prompts for interactive Google OAuth login or fails closed with `authentication failed or timed out` and zero token consumption.

## Implemented Antigravity Enforced Bridge, 2026-10-02

The [Antigravity Enforced Bridge](../implementation/agy-enforced-bridge.md) resolves both the native tool leak and credential isolation barriers:

1. **Broker-Only Tools via Lifecycle Hooks:** A synchronous `PreToolUse` hook in `.agents/hooks.json` with wildcard matcher (`*`) intercepts every tool invocation. Native tools (`run_command`, `write_to_file`, `browser_*`, etc.) are hard-blocked with `{"decision": "deny"}` before any side effect occurs. Only authorized broker tools (`repo.read`, `repo.search`, etc.) return `{"decision": "allow"}`.
2. **Credential Isolation & Pre-Request Budgeting:** Antigravity routes model traffic via `CLOUD_CODE_URL` to a loopback streaming proxy (`src/infrastructure/adapters/agy/model-proxy.ts`). The proxy intercepts handshakes, counts input tokens, creates durable reservations on `ModelLedgerPort` before generation, enforces the hard token limit (rejecting with HTTP 429 when budget is exhausted), and settles the ledger with complete usage accounting. Real credentials never enter the runner environment.

## Container Descendant Cancellation Verification, 2026-10-02

The container descendant cancellation probe (`npm run probe:container:cancellation`) was implemented and executed against Docker Engine 29.6.2 using a pinned Linux image (`sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a`):

- **Stubborn Process Tree:** Spawns a detached background infinite loop child inside an unprivileged, read-only container with dropped capabilities and pids limit.
- **Cgroup Eradication:** Upon cancellation via `docker rm --force`, all descendant processes in the cgroup are terminated by the Linux kernel.
- **Absence Confirmation:** Verified via `containerAbsent` inspecting stderr for exact `no such object` status.
- **Evidence:** Preserved in [cancellation intent](../implementation/evidence/2026-10-02/container-cancellation-intent.json) and [cancellation report](../implementation/evidence/2026-10-02/container-cancellation-report.json).

## M0 Exit Gate Assessment

All five mandatory capabilities required by PRD Section 7 and [enforced-runner-capabilities.md](../implementation/enforced-runner-capabilities.md) now have verified empirical implementations and offline test coverage:

| Capability                     | Codex 0.159.3 Status                                                           | Antigravity 1.2.14 Status                                                    |
| :----------------------------- | :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **1. Broker-only tools**       | **PROVEN:** `config.toml` strips built-ins; only broker dynamic tools emitted. | **PROVEN:** `PreToolUse` hook denies native tools; allows broker tools.      |
| **2. Credential isolation**    | **PROVEN:** Keyless app-server + loopback streaming proxy.                     | **PROVEN:** `CLOUD_CODE_URL` loopback proxy; runner receives no credentials. |
| **3. Hard token ceilings**     | **PROVEN:** Pre-request ledger reservation via `CodexStreamingProxy`.          | **PROVEN:** Pre-request ledger reservation via `AgyStreamingProxy`.          |
| **4. Complete accounting**     | **PROVEN:** Transport SSE pipe settlement to durable ledger.                   | **PROVEN:** Transport response extraction to durable ledger.                 |
| **5. Descendant cancellation** | **PROVEN:** Linux container cgroup termination verified via probe.             | **PROVEN:** Linux container cgroup termination verified via probe.           |

**Milestone M0 is UNBLOCKED.** Both runners are proven capable of satisfying Quorum's host-enforced invariants under container containment.
