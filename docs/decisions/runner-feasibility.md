# Initial runner feasibility investigation

Status: basic connectivity observed for both targets; enforcement unresolved. M0 is not complete; enforced release remains blocked.

On 2026-10-01 local executable discovery found:

- Codex: `/Users/eltonjames/.local/bin/codex`
- Antigravity target label `agy`: `/Users/eltonjames/.local/bin/agy`
- Container CLI: `/usr/local/bin/docker`
- Host development tools: Node.js 25.9.0, npm 11.12.1, Git 2.49.0.

Executable presence does not establish the integration surface, version, supported invocation, isolation, authentication, accounting, or broker compatibility. No runner was launched and no paid/provider probe was performed during the original foundation slice. Subsequent user-run smoke results are recorded below. The container daemon was not contacted. No runner/container/model version is pinned or advertised as supported.

Reproducible probe plan, independently for each target:

1. Inspect the discovered executable and its documented read-only version/help surface. Capture exact version, integration API/CLI, model selection, and authentication requirements without collecting credentials. Do not assume `agy` is a headless runner.
2. In a disposable fixture and isolation environment, bind a versioned structured response schema and attempt unknown identity/authority fields. Record raw completion separately from output validation.
3. Supply only the planned broker tools. Attempt shell, filesystem, child-process, Git metadata, artifact, runtime socket, and network escapes. Every effect must remain brokered; unsupported tool removal is a blocker.
4. Keep model credentials outside role/check mounts and process arguments. Test model-endpoint routing independently from offline check networking.
5. Reserve a hard request token ceiling before each model call, including tool iterations and provider retries. Verify input/output/cached/reasoning usage and conservatively retain reservations after interrupted or missing accounting. A post-hoc estimate is insufficient.
6. Cancel a fixture that launches a stubborn descendant; confirm all descendants terminate. Unconfirmed cleanup blocks resume and cleanup.
7. Repeat successful probes against pinned versions and preserve machine-readable evidence before creating production adapters.

| Capability                             | Antigravity (`agy`)    | Codex                  |
| :------------------------------------- | :--------------------- | :--------------------- |
| Exact integration/version/model        | Unverified             | Unverified             |
| Schema-bound output                    | Live probe pending     | Live probe pending     |
| Broker-only effects                    | Unverified             | Unverified             |
| Credential and network separation      | Unverified             | Unverified             |
| Container boundary                     | Unverified             | Unverified             |
| Hard token ceilings and complete usage | Unverified             | Unverified             |
| Descendant cancellation/recovery       | Unverified             | Unverified             |
| Proceed decision                       | Blocked pending probes | Blocked pending probes |

The pure engine can progress independently. No permissive fallback or advisory result can satisfy these release gates.

## User-provided connectivity evidence

The user supplied terminal transcripts during follow-up verification on 2026-10-01. These are user-reported observations, not independently rerun conformance evidence. The previously discovered versions were Codex 0.157.1 and `agy` 1.2.14; the transcripts do not themselves attest versions.

- Codex with explicitly selected `gpt-6-sol` returned `QUORUM_OK` and `turn.completed`. Reported usage: 16,060 input tokens, including 11,776 cached input tokens; 8 output tokens; 0 reasoning output tokens. Earlier `gpt-6.1-sol` attempts failed with a ChatGPT-account model-access error. No automatic fallback is authorized by this observation.
- Antigravity returned `SUCCESS`, `QUORUM_OK`, one turn, and 4.804346 seconds. Reported usage: 29,285 input tokens, 60 output tokens, 55 thinking tokens, 0 cache-read tokens, and 29,345 total tokens. The selected model was not supplied. Token field inclusion/overlap semantics remain unverified; do not infer complete accounting from the total.
- Neither request exercised schema-constrained output, broker enforcement, hard ceilings, credentials/network isolation, or descendant cancellation. High context overhead warrants investigation.

The supplied stdout is preserved in `tests/fixtures/runners/codex-smoke.jsonl` and `tests/fixtures/runners/agy-smoke.json`. Fixtures are historical inputs, not proof that a new live run passed. Fake structured responses used by offline tests are visibly synthetic and establish only probe-validator behavior.

The repeatable structured-output probes and their limitations are described in [the probe report](../implementation/runner-probes.md). Full `test:conformance` remains unavailable; smoke success does not clear M0.
