# Antigravity enforced bridge

**Status:** The pinned `agy` 1.2.14 CLI, lifecycle hook, production loopback proxy, durable ledger, and bounded local provider have passed one repeatable macOS offline probe. No external model request was made. Final Linux containment, actual-provider accounting, cancellation, complete broker-tool execution, capability receipts, and `doctor` integration remain unverified.

## Observed runner route

Antigravity's direct Gemini mode is the working local integration surface. The isolated runner home contains:

```json
{ "toolPermission": "always-proceed", "modelProvider": "gemini" }
```

The runner receives a non-secret `GEMINI_API_KEY` sentinel and `GOOGLE_GEMINI_BASE_URL` points to Quorum's loopback proxy. The proxy requires that exact sentinel, replaces it with a proxy-owned upstream credential, and permits only allowlisted `v1beta/models/{model}:streamGenerateContent?alt=sse` routes. The earlier `CLOUD_CODE_URL` design did not reach the local endpoint before OAuth and is no longer the implemented contract.

The proxy injects the host output-token ceiling, binds an exact canonical payload count, durably reserves input plus capped output, rechecks authorization, denies redirects, and settles only from one complete bounded usage record. A bounded in-process ledger serializer handles the overlapping requests observed from `agy` without weakening the durable ledger's cross-process lock.

## Tool gate

[`tool-gate.ts`](../../src/infrastructure/adapters/agy/tool-gate.ts) installs a wildcard `PreToolUse` hook in `.agents/hooks.json`. It allows only the seven broker tool names and denies malformed, native, or unknown tool calls. In the retained real-runner probe, the fake model requested `run_command` with `touch QUORUM_TOOL_LEAK`; the hook denied it and the marker was absent after completion.

This establishes native-tool denial for the observed request. The probe does not yet establish working broker-tool transport or exhaustive denial of every inherited/plugin tool in the final container.

## Repeatable probe and evidence

After building, run:

```sh
node scripts/probe-agy-conformance.mjs \
  --executable /Users/eltonjames/.local/bin/agy \
  --expected-version 1.2.14 \
  --model gemini-3.8-flash-medium \
  --report-dir /tmp
```

The probe uses a fresh home and workspace, a macOS sandbox allowlisting only two loopback ports, a strict fake Gemini provider, fixture credentials, four-request maximum, 30-second process deadline, and 1 MiB output limit. It records intent before launch and never reads user credentials. The retained [report](evidence/2026-10-02/agy-conformance-report.json) records:

- matching version and unchanged executable digest;
- three runner requests admitted and six ledger events persisted;
- only the upstream fixture credential reached the provider;
- direct Gemini routes, complete synthetic usage, and `QUORUM_OK` completion;
- observed `run_command` denial and absent side effect;
- zero external model attempts;
- `enforced_conformance: false` and `mandatory_capabilities: "PARTIAL"`.

The production proxy and probe behavior are covered by [`agy-enforced.test.ts`](../../tests/integration/agy-enforced.test.ts), [`agy-upstream.test.ts`](../../tests/integration/agy-upstream.test.ts), [`agy-conformance.test.ts`](../../tests/integration/agy-conformance.test.ts), and [`serialized-ledger.test.ts`](../../tests/unit/serialized-ledger.test.ts).

## Final-container image preflight

`probe:agy:container-image` validates a locally available, digest-pinned Linux image without pulling it or making a model request. It rejects declared volumes, clears baked environment values, creates a non-root read-only container with no network, capabilities, bind mounts, or writable root, verifies the inspected Docker configuration, hashes the runner executable with `docker cp`, checks the exact `agy --version` output, and reconciles cleanup even after an ambiguous create failure. Passing this preflight still records `final_container_conformance: false`; it proves only that the image is suitable for the later protocol probe.

The previously used cached validation image was checked as the current candidate. The retained [blocked report](evidence/2026-10-02/agy-container-image-blocked-report.json) records Docker 29.6.2, a matching Linux image digest, no container creation, confirmed cleanup, and `IMAGE_POLICY_FAILED` because the image declares an implicit writable volume. It also does not contain `agy`. The host installation is a macOS ARM binary and cannot satisfy the Linux image requirement.

The next prerequisite is a purpose-built, digest-pinned image containing Linux `agy` 1.2.14 and Quorum's hook transport. Provisioning that binary or pulling/building an image remains an explicit external step; the probe never installs software automatically.

## Remaining M0 limits

| Capability              | Current evidence                                                                                          | Missing evidence                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Broker-only tools       | Real hook denied one native command before its side effect.                                               | Broker tool calls and exhaustive inherited-tool denial in the final container.            |
| Credential isolation    | Runner held only a sentinel; proxy inserted the local fixture credential under sandboxed loopback egress. | Final Linux mounts/environment/egress and a real broker-owned provider credential.        |
| Hard token ceilings     | Every observed local request reserved exact counted input plus a proxy-injected output cap.               | Provider-attested count semantics and retry/iteration behavior against the real service.  |
| Complete accounting     | Three requests produced six durable reserve/settle events with strict synthetic usage.                    | Actual provider streams, hidden retries, interruption, and cumulative-category semantics. |
| Descendant cancellation | Generic container cgroup cancellation passed elsewhere.                                                   | A suitable runner image, then pinned `agy` cancellation in the final container.           |

M0 remains blocked until both pinned runners pass independent final-container conformance and verified receipts are consumed by `doctor`. `test:conformance` is still intentionally unavailable.
