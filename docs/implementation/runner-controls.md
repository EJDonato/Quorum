# Pinned runner control investigation

Date: 2026-10-01. Investigation pins: Codex 0.159.3 and Antigravity CLI 1.2.14. **M0 remains BLOCKED.** No product scope change or full conformance capability is claimed.

## Codex 0.159.3

Observed locally, without model generation:

- `exec --help` exposes structured output, read-only sandbox, ephemeral runs, `--ignore-user-config`, `--ignore-rules`, and strict configuration options. None proves elimination of built-in effects. The schema smoke used the existing user configuration; it did not exercise those configuration-isolation flags.
- `features list` exposes `shell_tool`, `unified_exec`, `token_budget`, and `rollout_budget`. Running `codex --disable shell_tool --disable unified_exec features list` exited 0 and reported `shell_tool=false`, **`unified_exec=true`**, and both budget features disabled. This registry result is inconclusive about actual tool exposure and does not prove broker-only control. Investigate configuration precedence and the effective tool inventory before adopting a toggle recipe.
- `app-server generate-json-schema --experimental` succeeded and produced the pinned executable's protocol definitions in `/private/tmp/quorum-codex-01593-schemas`. `ThreadStartParams` exposes `dynamicTools` and an arbitrary `config` object. `TurnStartParams` exposes `outputSchema`; neither has a top-level hard request token limit. These definitions suggest a broker integration path but prove neither built-in tool exclusion nor runtime implementation. An arbitrary config field may accept settings beyond top-level fields, so the absence is not proof that a ceiling is impossible.
- Read-only `--strict-config` feature-list attempts with `max_output_tokens=64` and with `features.rollout_budget={enabled=true,limit_tokens=64}` both exited 1. Their retained metadata does not establish the cause; neither attempt sent a model request or tested a ceiling. Do not label either setting supported or unsupported from this result.

The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes shell toggles, experimental rollout-budget tracking/reminders, and a tool-output history limit. Tracking, reminders, context sizes, and retained tool-output limits are not observed hard provider request ceilings. No experiment here proved reservation before a request or coverage of tool iterations, transport retries, cached tokens, and interrupted usage.

Next reproducible gate: pin the executable and model, start the app-server in a disposable isolated environment, enumerate effective built-ins alongside a single inert broker tool, then exercise every denied shell/file/network/delegation route. Separately inspect and test the actual provider request ceiling before dispatch, including rejection at the limit and retained reservations after interrupted accounting. These will require separately authorized live work and the missing sandbox/broker fixture; a model saying it lacks tools is insufficient evidence.

## Antigravity CLI 1.2.14

Observed locally:

- `--help` exposes schema output, model selection, plan mode, sandbox mode, and a print timeout. No tool-only allowlist or hard token ceiling flag was present in that help. This is a bounded observation of the CLI surface, not a proof that all internal APIs lack such controls.
- The current configured model label matches a catalog entry for `gemini-3.8-flash-medium`. Model discovery initially failed under host sandbox restrictions, then succeeded with authorized local-runtime access. Discovery is not a paid-generation probe or an isolation test.
- Its one authorized schema attempt exited 0 but failed host protocol validation. The retained report has no raw envelope or reliable usage for that failed response. A fresh instrumented probe needs new live authorization; no parser change can grant retrospective success.

The [CLI configuration reference](https://antigravity.google/docs/cli/reference) describes permission presets that request review or allow sandbox actions. Approval prompts do not establish broker-only effects. The [SDK tool documentation](https://www.antigravity.google/docs/sdk/tools/) describes built-in tool filtering with `CapabilitiesConfig.enabled_tools` / `disabled_tools` and custom functions. This is a **documented investigation lead for a different integration surface**, not a capability observed in CLI 1.2.14. No SDK was installed, no Python orchestration layer was introduced, and no SDK version/binary was pinned or tested.

The [headless documentation](https://www.antigravity.google/docs/cli/headless/) describes streaming initialization/tool inventories and per-step usage, plus final schema output. Future probes can use those fields to inspect exposure and retain safe structural failure details, but they have not been observed in this CLI/model experiment. Final JSON alone cannot establish absence of tool execution or pre-request token enforcement. Quota displays and timeouts do not supply a hard per-request token ceiling.

Next reproducible gate: establish a CLI-compatible mechanism to remove every non-broker effect, or explicitly resolve the integration contract before attempting the SDK path. Pin whichever surface is tested; prove credential/network separation, exact tool exposure, denial of escapes, and request/iteration/retry token ceilings. Do not transfer SDK documentation claims to the CLI column in the feasibility table.

## Evidence and limits

The [read-only discovery record](evidence/2026-10-01/read-only-discovery.json) preserves successes and failures without copying credentials, configuration bodies, logs, or prompts. Both live intent/result records are retained alongside it. User configuration and provider-internal retries were not isolated/measured, model revisions were not attested, and descendant cleanup is unconfirmed. No live control/escape or hard-ceiling experiment was authorized or performed. Full `test:conformance` remains explicitly unavailable.
