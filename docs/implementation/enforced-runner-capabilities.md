# Enforced runner capability investigation

Date: 2026-10-02. **Both runners remain BLOCKED for enforced operation.** This investigation establishes current metadata and offline harness behavior; it does not prove impossibility for every integration surface or version. It supersedes capability conclusions in the earlier feasibility matrix where those conclusions overstate accounting or cancellation.

Implementation follow-up: the [offline Codex protocol and local fake-provider probe](codex-offline-protocol.md) is implemented and exercised. The latest retained 0.159.3 request contains only the registered `repo.read` namespace after disabling `view_image` and experimental `request_user_input`. A request firewall and bounded streaming proxy inject the host cap, bind exact counts, reserve durably and preserve uncertain charges. This remains component evidence: Codex has not run through that path in the final Linux container.

The [Antigravity bridge](agy-enforced-bridge.md) implements a standalone lifecycle-hook gate and a bounded upstream proxy. Loopback tests now prove explicit fixture/upstream modes, destination restriction, credential injection after reservation and reauthorization, strict usage parsing, actual settlement values and reservation retention on incomplete accounting. These are component tests: they do not establish the real CLI hook, provider semantics, hidden iterations or final container boundary. The generic Docker cancellation probe proves cgroup removal for a synthetic process tree, not either pinned runner. These limitations keep the mandatory matrix blocked.

Requirements: PRD Sections 3.1, 4.2, 7 and acceptance criteria 6, 10, 12; SYSTEM_DESIGN Sections 2 and 5.2; implementation milestone M0. For the original metadata investigation, no runtime adapter, product requirement, or TypeScript architecture was changed, and no model request, credential inspection, package installation, image pull, or new real-container experiment was performed. The subsequent offline implementation sent only local fake-provider requests, as recorded separately above.

## Capability matrix

“Unverified” means unavailable to enforced dispatch. “Failed approach” identifies an observed counterexample, not universal impossibility. Historical schema smoke success is separate from the five mandatory capabilities below.

| Capability                | Codex 0.159.3                                                                                                    | Antigravity CLI 1.2.14                                                                                                                             | Required evidence to clear gate                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broker-only tools         | Partial: latest local fake-provider observation contains only `repo.read`; final container composition untested. | Partial: standalone hook gate denies native names; no retained real-`agy` tool-attempt evidence.                                                   | Complete effective tool inventory and host denial of every non-broker effect, including file reads, shells, network, delegation, MCP/plugins and inherited configuration.                       |
| Credential isolation      | Partial: loopback proxy owns fixture credential; final runner environment/egress route untested.                 | Partial: restricted upstream forwarding owns the fixture credential; real runner environment and bypass resistance are untested.                   | Broker alone holds credentials; runner and descendants cannot access credential files, environment, arguments or network routes bypassing broker.                                               |
| Hard token ceilings       | Partial: fixture proxy binds exact counts and reserves before upstream.                                          | Partial: exact-count reservation and returned-usage bounds pass a fake upstream; real provider/iteration enforcement is unverified.                | Bound each request before transmission, including input, output, reported cached/reasoning tokens and every iteration/retry. Reject or constrain requests before they exceed reserved capacity. |
| Complete usage accounting | Partial: bounded SSE completion/detail validation and interruption retention exist for fixtures.                 | Partial: strict JSON/SSE usage settlement and uncertain-charge retention pass fixtures; real cumulative streams and hidden retries are unverified. | Reconcile every dispatched request exactly once, document overlapping categories, include hidden retries/iterations, preserve reservations on incomplete or interrupted accounting.             |
| Descendant cancellation   | Partial: generic container cgroup removal passed; pinned runner containment remains unverified.                  | Partial: generic container cgroup removal passed; pinned runner containment remains unverified.                                                    | Real pinned runner in final isolation boundary, detached/stubborn descendants, cancellation/timeout/crash, verified absence and fail-closed uncertain cleanup.                                  |
| Enforced decision         | **BLOCKED**                                                                                                      | **BLOCKED**                                                                                                                                        | Every mandatory row must pass independently for each target.                                                                                                                                    |

A host reservation plus post-completion overrun rejection cannot bound provider consumption. Neither a passing response schema nor a model claiming it has no tools satisfies a capability gate.

## Fresh read-only discovery

Reports and pre-effect intents are retained in [evidence/2026-10-02](evidence/2026-10-02/). Both executables matched expected versions and retained identical pre/post SHA-256 hashes. Codex metadata steps (version, help, features, generated schema) passed; Antigravity version/help passed. Reports mark every enforcement observation UNVERIFIED and enforced_conformance=false. Generated schemas were confined to temporary storage; user configuration and credentials were not copied.

Reproduce from the repository, with installed development dependencies:

```sh
npm run build
node scripts/probe-controls.mjs --runner codex --executable /Users/eltonjames/.local/bin/codex --expected-version 0.159.3
node scripts/probe-controls.mjs --runner agy --executable /Users/eltonjames/.local/bin/agy --expected-version 1.2.14
```

The metadata script has no model-call option and rejects --live. Version mismatch blocks later discovery. These paths are local investigation pins, not a supported release manifest.

## Minimal offline reproductions

Existing TypeScript fixtures supply the following executable reproductions; synthetic runners and Docker doubles cannot attest real runner safety.

| Requirement             | Reproduction                                                                            | Observable result and limitation                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broker-only tools       | control-discovery.test.ts: inert broker test                                            | Rejects shell, traversal, absolute paths, arbitrary HTTP/artifact writes, delegation and forged identity; permits only the fixed read. Tests broker fixture, not actual runner built-ins.                                          |
| Credential isolation    | validation-executor.test.ts: forbidden environment and unexpected daemon settings cases | Host blocks forbidden environment inputs and unsafe mounts/network settings before start. Fake Docker verifies host decisions; existing six real validation-container fixtures are historical supporting evidence for checks only. |
| Hard token ceilings     | transitions.test.ts: token reservation/cancellation/resume case                         | Insufficient host budget blocks reservation; cancellation/resume retain charges. Demonstrates ledger only; no provider refusal ceiling.                                                                                            |
| Usage accounting        | runner-probe.test.ts: malformed/missing usage, interrupted and partial completion cases | Rejects missing/negative primary counts, tool events and incomplete completion. Does not observe retries or prove category completeness.                                                                                           |
| Descendant cancellation | cancellation.test.ts: in-group and detached descendant cases                            | In-group children stop; detached child survives group kill and is explicitly killed by fixture cleanup. This is a concrete failure of process groups as the sole boundary.                                                         |
| Cleanup uncertainty     | validation-recovery.test.ts                                                             | Unconfirmed cleanup blocks evidence publication; ownership mismatch blocks recovery; interrupted check is not replayed as approval.                                                                                                |

```sh
node --test dist/tests/integration/control-discovery.test.js dist/tests/integration/runner-probe.test.js dist/tests/integration/cancellation.test.js dist/tests/unit/transitions.test.js
node --test dist/tests/integration/container-boundary.test.js dist/tests/integration/validation-executor.test.js dist/tests/integration/validation-recovery.test.js
```

Executed results: build passed; first group 25/25 passed; second group 26/26 passed; zero failures/skips. No full conformance or model evaluation was run. The existing conformance command remains unavailable. This investigation changes documentation and retained metadata only.

## Documentation leads and interpretation

Sources fetched on 2026-10-02; current documentation is not version-pinned runtime evidence:

- [Codex app-server](https://learn.chatgpt.com/docs/app-server) documents experimental dynamic tool registration and token-usage notifications. These are integration leads; they do not establish an exclusive broker tool inventory or complete accounting.
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference) describes rollout-budget tracking and reminders. No pre-request hard ceiling is established by those settings.
- [Antigravity headless](https://www.antigravity.google/docs/cli/headless/) documents initialization tool inventory, per-step usage and parsed structured output. It also describes cumulative usage across streamed turns. Production normalization must avoid summing cumulative terminal records repeatedly or guessing cache/thinking overlap.
- [Antigravity SDK tools](https://www.antigravity.google/docs/sdk/tools/) documents capabilities filtering. This is a Python SDK example, not observed CLI support. Preserve the TypeScript harness; do not add an orchestration framework or transfer SDK claims to CLI 1.2.14.

## Experiment plan and implementation status

The user subsequently authorized implementation. Codex local fake-provider admission and proxy fixtures, Antigravity offline inventory/hook and bounded-upstream fixtures, and generic container cancellation are implemented. Remaining work is actual Antigravity lifecycle-hook and provider execution, both pinned runners in the final container composition, versioned capability receipts, `test:conformance`, and `doctor` wiring. No new paid capability experiment has been executed.

Proceed offline first. A live execution command is intentionally unavailable until the transport, credential boundary and request ceiling are concrete and reviewable. Existing probe:runners only tests schema/connectivity and cannot execute the capability experiments below safely. Its historical authorizations do not authorize new attempts.

1. **Local protocol inventory (zero model attempts).** Build a TypeScript JSON-RPC fixture using the generated pinned Codex schemas, initialize app-server and register only an inert repo.read fixture. Stop before turn/start. Record protocol/config digests and effective tool inventory if actually exposed; do not infer inventory from dynamicTools. For Antigravity, establish a CLI-compatible filtering contract offline first. If inventory requires generation, defer it to an explicitly reviewed live experiment. Empty credential home/environment and offline transport required; no user auth mounts. Unsupported initialization/filtering blocks.
2. **Fake transport accounting (zero provider attempts).** Once endpoint substitution is proven, use a host-owned local fake provider, fixture credentials and harmless canaries. Capture request structure without raw secret-bearing headers. Simulate tool iterations, retry, stream interruption, repeated cumulative usage and cache/thinking overlap. Assert pre-transmission reservations and conservative interrupted charges. Reject unsupported endpoint routing; do not repurpose authenticated user sessions.
3. **Runner isolation/cancellation (zero provider attempts where fake transport works).** Use an already provisioned pinned Linux image and final broker transport; no checkout/artifact/auth/socket mounts. Inject fake credential canaries only. Exercise forbidden routes and detached/stubborn descendants through fixture-controlled actions, without adding a production shell tool. Confirm container/cgroup absence after timeout, cancel and interrupted cleanup. Unsupported image/runner/fake transport blocks; report every failure.
4. **Paid capability confirmation (only after offline prerequisites pass).** Separate one attempt per pinned runner and experiment; no harness retries or fallback. Proposed requested models remain gpt-6-sol and gemini-3.8-flash-medium, with actual access rechecked before dispatch. Synthetic files only, one inert broker read, 60-second deadline, 1 MiB bounded diagnostics, no real repository or secret canaries. Broker holds authentication and records request IDs, token ceilings, usage categories and retry counts. A hard total input/output ceiling and its enforcement mechanism must be specified and offline-verified before asking for authorization. Do not invent a 64-token flag, equate output-only limits with total limits, or promise a cost maximum without configured pricing. If either CLI cannot route requests through that boundary, the experiment stays blocked.

For a future approval request, present exact executable/image/configuration digests, argv or JSON-RPC messages, synthetic prompt and schema, tools, mounts/egress, credential route, per-request and aggregate token/cost limits, retry policy, cancellation/cleanup assertions, evidence retention and expected denial cases. Persist intent before execution; retain failed attempts. No approval is being requested by this report.

## Recommended next work

Build one offline conformance command that launches each pinned runner through its broker/proxy inside the final container. For Antigravity, first capture the real hook invocation and fake-upstream stream shape so the current component contract is checked against CLI 1.2.14. The command must retain version/config/image/evidence digests and negative cases. Wire `doctor` only to verified receipts from that command. Keep enforced dispatch and verified finalization blocked until both runner receipts pass independently.
