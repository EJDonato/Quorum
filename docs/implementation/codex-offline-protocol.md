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

The current script also fsyncs `execution-plan.json` before the first runner subprocess, recording exact executable identity, configuration/profile digests, environment, working directory and metadata/app-server argv. The retained successful observation predates that additional plan record; its configuration and sandbox bytes are archived alongside its intent/report.

Reports retain binary/schema/configuration/sandbox byte digests, normalized fake usage, observed tool names and failure categories. Raw headers, prompts, response payloads and stderr are not retained. Protocol requests from the server, including tool calls and approval requests, stop the experiment; the inert read has no executable handler. Report success means the protocol experiment completed, while `enforced_conformance=false` and `mandatory_capabilities=UNVERIFIED` remain explicit.

## Observed results

- [Initialization report](evidence/2026-10-02/codex-offline-initialize-report.json): initialization and registration succeeded with networking denied. No model turn was dispatched. This response exposes no exhaustive effective tool inventory.
- [Initial fake-provider report](evidence/2026-10-02/codex-offline-initial-provider-report.json): the request included `repo.read`, delegation tools, goal tools and `request_user_input`, despite disabling shell features. Dynamic registration alone does not remove built-ins.
- [Final fake-provider report](evidence/2026-10-02/codex-offline-provider-report.json): explicitly disabling `multi_agent`, `goals`, `hooks` and `plugins` removed delegation and goal tools from the observed request. Its tool list still contained `request_user_input` and `repo.read`. No `max_output_tokens` was supplied. No hard total input/output ceiling was established.
- The fake provider supplied 10 input and 3 output tokens, including 2 cached input and 1 reasoning output tokens. Codex reported the same normalized total of 13. These are invented fixture counts, not actual provider consumption or proof of complete retry/iteration accounting.

The first sandboxed attempt could not initialize the nested OS boundary. A separate fake-provider attempt failed because the generated sandbox network-address syntax was invalid; it was corrected from an IP literal to `localhost:PORT`. Both [failed reports](evidence/2026-10-02/codex-offline-host-sandbox-failed-report.json) and [the syntax failure](evidence/2026-10-02/codex-offline-profile-failed-report.json) are retained with their intents. Successful later attempts do not reclassify either failure. Earlier development reports predate the final strict report schema; they remain historical records.

## Repeatable coverage and limits

`tests/integration/codex-offline.test.ts` uses visibly synthetic Node subprocesses and no HTTP listeners, Docker or installed Codex. It covers initialization without generation, identity correlation, malformed/duplicate messages, forbidden server requests, cumulative usage replacement, cache/reasoning overlap, invalid/missing usage, interruption preserving observed usage, output overflow, timeout, cancellation before launch, environment isolation and rejection of forged capability reports.

The local macOS profile is an experiment boundary, not the required production Linux runner containment. Process-group cleanup cannot prove detached descendants terminated. No real-runner cgroup/cancellation test, credential-bearing broker, provider-enforced ceiling, stream-retry/tool-iteration conformance or Antigravity transport implementation was completed here. Existing `test:conformance`, doctor, enforced dispatch and verified finalization remain blocked.

The next implementation boundary is a credential-holding broker model gateway that constrains every request **before transmission**, validates the complete effective tool surface, normalizes request-level accounting and runs the actual pinned runner inside the final containment boundary. Endpoint substitution is now observed for Codex; sufficient token-limit and tool-filtering contracts still need to be demonstrated. Antigravity requires independent CLI-compatible evidence. A timeout, host reservation or post-completion rejection cannot replace the hard ceiling required by PRD Section 3.1.

Verification: `npm run check` passed formatting, lint, typecheck, build, published-schema consistency, 42 unit tests and 129 integration tests with zero failures/skips. Eleven integration tests are new offline-probe regressions. The size check passed with a 257-line script warning against the 250-line target; it remains below the 350-line review limit. No release conformance, model evaluation, real-container rerun or paid capability confirmation was executed for this change.

Protocol leads: [official app-server documentation](https://learn.chatgpt.com/docs/app-server) describes the initialization lifecycle and experimental dynamic registration. [Official configuration documentation](https://learn.chatgpt.com/docs/config-file/config-reference) documents the provider endpoint and feature controls used here. These current documents support the investigation; the retained pinned-binary observations support its results.
