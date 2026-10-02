# Offline Codex protocol and provider fixture

Implemented and exercised on 2026-10-02 against Codex 0.159.3. **M0 remains blocked.** This is an experimental feasibility probe, not a production adapter or a conformance certificate. Antigravity is not covered by these results.

The probe now establishes two concrete facts: the pinned Codex app-server accepts Quorum's inert `repo.read` registration without user credentials, and its inference request can reach a host-owned local fake Responses provider. No paid provider requests were made. The fake provider has no upstream client and accepts at most one valid request.

## Reproduce

With installed project dependencies and the pinned executable, on macOS:

```sh
npm run probe:codex:offline -- --executable /Users/eltonjames/.local/bin/codex --expected-version 0.159.3
npm run probe:codex:offline -- --executable /Users/eltonjames/.local/bin/codex --expected-version 0.159.3 --fake-provider
```

The first command stops after `thread/start`; it cannot send `turn/start`. The second sends one fixed synthetic prompt to the local fake provider. Neither mode can select a real model or an external provider. Unsupported platforms block rather than run without isolation. A surrounding execution sandbox may require permission to launch the nested macOS sandbox or bind the fixture listener.

Both commands reserve a private evidence directory and fsync an intent before launching processes. They use an empty HOME/CODEX_HOME, an explicit environment without inherited keys/proxies, a synthetic working directory, and a macOS profile denying network access, user-home reads and writes outside the evidence directory. Only the resolved executable is readable inside the user home. Fake-provider mode permits outbound loopback traffic solely to its fixture port. Schema generation and the protocol client use that same profile. Each subprocess has a 10-second deadline and 1 MiB combined output limit. The provider also limits request body size to 1 MiB.

The current script also fsyncs `execution-plan.json` before the first runner subprocess, recording exact executable identity, configuration/profile digests, environment, working directory and metadata/app-server argv. The repeated successful observation retains that plan, configuration and sandbox bytes alongside its intent/report.

Reports retain binary/schema/configuration/sandbox byte digests, normalized fake usage, observed field names and container types, tool identities/types and failure categories. Raw headers, prompts, instructions, tool arguments, response payloads and stderr are not retained. Protocol requests from the server, including tool calls and approval requests, stop the experiment; the inert read has no executable handler. Report success means the protocol experiment completed, while `enforced_conformance=false` and `mandatory_capabilities=UNVERIFIED` remain explicit.

## Observed results

- [Initialization report](evidence/2026-10-02/codex-offline-initialize-report.json): initialization and registration succeeded with networking denied. No model turn was dispatched. This response exposes no exhaustive effective tool inventory.
- [Initial fake-provider report](evidence/2026-10-02/codex-offline-initial-provider-report.json): the request included `repo.read`, delegation tools, goal tools and `request_user_input`, despite disabling shell features. Dynamic registration alone does not remove built-ins.
- [Final fake-provider report](evidence/2026-10-02/codex-offline-provider-report.json): explicitly disabling `multi_agent`, `goals`, `hooks` and `plugins` removed delegation and goal tools from the observed request. The repeated 0.159.3 observation recorded 12 top-level field names, three message input items, function/namespace tool types, `stream: true`, `store: false`, no remote conversation identifiers and no `max_output_tokens`. Its tool list still contained `request_user_input` and `repo.read`. No hard total input/output ceiling was established.
- The fake provider supplied 10 input and 3 output tokens, including 2 cached input and 1 reasoning output tokens. Codex reported the same normalized total of 13. These are invented fixture counts, not actual provider consumption or proof of complete retry/iteration accounting.

The first sandboxed attempt could not initialize the nested OS boundary. A separate fake-provider attempt failed because the generated sandbox network-address syntax was invalid; it was corrected from an IP literal to `localhost:PORT`. Both [failed reports](evidence/2026-10-02/codex-offline-host-sandbox-failed-report.json) and [the syntax failure](evidence/2026-10-02/codex-offline-profile-failed-report.json) are retained with their intents. Successful later attempts do not reclassify either failure. Earlier development reports predate the final strict report schema; they remain historical records.

## Repeatable coverage and limits

`tests/integration/codex-offline.test.ts` uses visibly synthetic Node subprocesses and no HTTP listeners, Docker or installed Codex. It covers initialization without generation, identity correlation, malformed/duplicate messages, forbidden server requests, cumulative usage replacement, cache/reasoning overlap, invalid/missing usage, interruption preserving observed usage, output overflow, timeout, cancellation before launch, environment isolation and rejection of forged capability reports.

The local macOS profile is an experiment boundary, not the required production Linux runner containment. Process-group cleanup cannot prove detached descendants terminated. No real-runner cgroup/cancellation test, credential-bearing broker, provider-enforced ceiling, stream-retry/tool-iteration conformance or Antigravity transport implementation was completed here. Existing `test:conformance`, doctor, enforced dispatch and verified finalization remain blocked.

The first request-admission boundary is now implemented in `src/infrastructure/model-gateway/codex-request-firewall.ts`. It accepts only the pinned 12-field shape, requires the exact host model and broker wire-tool manifest, rejects duplicate/non-function/hosted tools and remote conversation or caller-supplied ceiling fields, then injects and freezes the host output cap. The observed real request fails closed because `request_user_input` is not one of Quorum's seven broker tools. The firewall is not an HTTP/SSE proxy and is not yet connected to durable counting/reservation, so it does not enable a runner adapter.

The next implementation boundary is the credential-holding streaming proxy that applies this firewall before counting, durably reserves the transformed request, forwards the exact counted bytes and reconciles every SSE completion/tool iteration. Codex configuration must first remove `request_user_input` or a supported app-server contract must let Quorum omit it; Quorum will not silently add that tool. Antigravity requires independent CLI-compatible evidence. A timeout, host reservation or post-completion rejection cannot replace the hard ceiling required by PRD Section 3.1.

Verification: `npm run check` passed formatting, lint, typecheck, build, published-schema consistency, 55 unit tests and 145 integration tests with zero failures/skips. The firewall adds four unit regressions, and the report-shape changes remain covered by the offline integration suite. The size check reported the existing 257-line probe script against its 250-line target; it remains below the 350-line review limit and its narrow exception is recorded in `docs/decisions/size-exceptions.md`. No release conformance, model evaluation, real-container rerun or paid capability confirmation was executed for this change.

Protocol leads: [official app-server documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) documents the stdio-to-Responses integration. [Official preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) state that this flow uses HTTP/SSE with `stream: true`, `store: false`, request history in `input`, and local capabilities represented as function/custom tools. These current documents support the investigation; the retained pinned-binary observations support its results.
