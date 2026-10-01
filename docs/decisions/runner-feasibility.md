# Initial runner feasibility investigation

Status: current model identified and one authorized schema probe per runner recorded. Codex passed the smoke validator; Antigravity failed it. Enforcement remains unresolved. **M0 is BLOCKED** until every mandatory capability is proven or the user explicitly revises product scope. Full `test:conformance` remains unavailable.

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

| Capability                             | Antigravity (`agy`)                                                                           | Codex                                                                    |
| :------------------------------------- | :-------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| Exact integration/version/model        | CLI 1.2.14 observed; current configured/catalog model identified; backend revision unverified | CLI 0.159.3 observed; requested `gpt-6-sol`; backend revision unverified |
| Schema-bound output                    | One live validator failure (`INVALID_PROTOCOL`); unresolved                                   | One schema-constrained smoke passed; adversarial enforcement unverified  |
| Broker-only effects                    | Unverified                                                                                    | Unverified; shell-disable registry result inconclusive                   |
| Credential and network separation      | Unverified                                                                                    | Unverified                                                               |
| Container boundary                     | Unverified                                                                                    | Unverified                                                               |
| Hard token ceilings and complete usage | Unverified                                                                                    | Unverified                                                               |
| Descendant cancellation/recovery       | Unverified                                                                                    | Unverified                                                               |
| Proceed decision                       | **BLOCKED**                                                                                   | **BLOCKED**                                                              |

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
