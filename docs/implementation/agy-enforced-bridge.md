# Antigravity Enforced Bridge Implementation

**Status:** Tool-gate and bounded upstream proxy components implemented with offline fixtures. Real-runner hook execution, provider semantics and final-container conformance remain unverified.

---

## 1. Context and Problem Statement

Antigravity CLI (`agy` 1.2.14) was previously blocked from Enforced Mode operation due to two hard constraints:

1. **Tool Restriction Leak:** `agy` unconditionally boots with 57 built-in native tools (`run_command`, `write_to_file`, `browser_*`, etc.) and provides no CLI flag to disable them.
2. **Credential and Network Isolation:** `agy` depends on Google OAuth authentication via macOS Keychain or user credentials, lacking an unauthenticated local endpoint mode.

---

## 2. Implemented Architecture

The Antigravity Enforced Bridge introduces two dedicated components placed under [`src/infrastructure/adapters/agy/`](../../src/infrastructure/adapters/agy/):

### A. Lifecycle Hook PreToolUse Gate ([`src/infrastructure/adapters/agy/tool-gate.ts`](../../src/infrastructure/adapters/agy/tool-gate.ts))

- **Host Interception:** Hooks into Antigravity's `.agents/hooks.json` lifecycle hook system via a synchronous `PreToolUse` hook with wildcard matcher `*`.
- **Broker-Only Enforcement:** Intercepts every tool invocation attempt:
  - **Default Broker Tools:** [`repo.read`, `repo.search`, `artifact.read`, `draft.apply_patch`, `checks.run`, `role.submit`, `scope.request`] return `{"decision": "allow"}`.
  - **Native & Unauthorized Tools:** (`run_command`, `write_to_file`, `browser_*`, etc.) return `{"decision": "deny", "reason": "..."}`.
  - **Fail-Closed:** Malformed or unrecognized hook payloads immediately fail closed with a denial.
- **Atomic Installation:** `installAgyToolGateHooks(workspaceDir, hookCommand, timeout)` writes `.agents/hooks.json` atomically with restricted file permissions (`0o600`).
- **Subprocess CLI Runner:** `runAgyToolGateCli` provides a standalone entry point reading `stdin` JSON payloads and outputting gate decisions to `stdout`.

### B. Loopback Model Streaming Proxy ([`src/infrastructure/adapters/agy/model-proxy.ts`](../../src/infrastructure/adapters/agy/model-proxy.ts))

- **Local Loopback Endpoint:** Binds to `127.0.0.1` and handles requests routed via `CLOUD_CODE_URL`.
- **API Handshakes:** Responds to `v1internal:loadCodeAssist` and `v1internal:fetchAvailableModels` with pinned configuration models and paid tier authorization.
- **Pre-Request Token Reservations:** On `generateContent` or `streamGenerateContent`:
  1. Verifies the configured capability and current authorization.
  2. Counts input tokens and requires the count digest to match the canonical request payload.
  3. Appends an atomic `reserved` event to [`ModelLedgerPort`](../../src/application/model-gateway-ports.ts). If the session budget is exhausted, rejects immediately with HTTP 429 (`BUDGET_EXHAUSTED`).
  4. Rechecks authorization before resolving credentials or contacting the upstream.
- **Explicit Response Modes:** Tests must opt into `kind: "fixture"`; there is no implicit synthetic fallback. `kind: "upstream"` accepts only the allowlisted Cloud Code origin or an explicit IPv4 loopback fixture, denies redirects, applies response and timeout bounds, and supplies the credential in the proxy-owned authorization header.
- **Strict Settlement:** The proxy buffers the bounded JSON or SSE response, requires exactly one complete `usageMetadata` record, conservatively derives output from `totalTokenCount - promptTokenCount`, validates cache/thinking overlap, requires provider input usage to equal the pre-request count, and publishes the response only after durable settlement. Missing, duplicate, inconsistent, interrupted or over-limit accounting leaves the reservation charged for reconciliation.
- **Clean Shutdown:** Tracks open sockets and closes connections cleanly upon test or session termination.

---

## 3. Test Verification

1. **Unit Tests ([`tests/unit/agy-tool-gate.test.ts`](../../tests/unit/agy-tool-gate.test.ts)):**
   - Default broker tools allowed (`repo.read`, etc.).
   - Prohibited native tools denied (`run_command`, `write_to_file`, `browser_open`, etc.).
   - Fail-closed behavior on null, undefined, empty, or malformed inputs.
   - Role-specific restricted tool sets (e.g. read-only roles).
   - Schema generation and atomic `.agents/hooks.json` installation.
   - CLI stream processing via stdin/stdout.

2. **Integration Tests ([`tests/integration/agy-enforced.test.ts`](../../tests/integration/agy-enforced.test.ts)):**
   - Real subprocess execution of the tool gate denying `run_command` and `write_to_file` while allowing `repo.read`.
   - Complete API handshake and generation loop through `AgyStreamingProxy`.
   - Durable file ledger verification confirming sequential `reserved` and `settled` events in `events/`.
   - Hard token ceiling rejection with HTTP 429 when budget is exhausted.
   - Count-digest substitution rejection before reservation and authorization revocation after reservation.

3. **Upstream Tests ([`tests/integration/agy-upstream.test.ts`](../../tests/integration/agy-upstream.test.ts), [`tests/unit/agy-upstream.test.ts`](../../tests/unit/agy-upstream.test.ts)):**
   - Canonical request forwarding to a loopback upstream with a proxy-owned credential.
   - Settlement from returned cache, thinking and total usage instead of a fabricated token value.
   - Reservation retention when usage is absent, plus endpoint allowlist and duplicate-usage rejection.

---

## 4. Capability Matrix Update

| Capability                     | Status      | Implementation Mechanism                                                                                                                       |
| :----------------------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Broker-Only Tools**       | **PARTIAL** | Standalone hook gate denies native names; actual `agy` lifecycle invocation still needs conformance evidence.                                  |
| **2. Credential Isolation**    | **PARTIAL** | Proxy-owned upstream credential and restricted destinations pass loopback tests; real runner environment and egress evidence are absent.       |
| **3. Hard Token Ceilings**     | **PARTIAL** | Exact-count reservation and returned-usage bounds pass through a fake upstream; actual provider/iteration enforcement is unverified.           |
| **4. Complete Accounting**     | **PARTIAL** | JSON/SSE usage validation and uncertain reservation retention pass fixtures; actual cumulative stream and hidden-retry behavior is unverified. |
| **5. Descendant Cancellation** | **PARTIAL** | Generic cgroup cancellation passed; the pinned runner was not exercised in that container.                                                     |
