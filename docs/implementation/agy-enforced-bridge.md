# Antigravity Enforced Bridge Implementation

**Status:** Tool-gate lifecycle interception and loopback proxy with ledger reservation/accounting implemented. Offline unit and integration tests passing.

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
  1. Counts input tokens using `gateway.provider.countInput`.
  2. Binds payload digest and capability digest.
  3. Appends an atomic `reserved` event to [`ModelLedgerPort`](../../src/application/model-gateway-ports.ts). If the session budget is exhausted, rejects immediately with HTTP 429 (`BUDGET_EXHAUSTED`).
- **Complete Transport Accounting:**
  - Extracts exact token usage (prompt tokens, candidate tokens, cached tokens, and reasoning tokens).
  - Settles the ledger transaction via atomic append of a `settled` event with complete accounting confirmation.
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

---

## 4. Capability Matrix Update

| Capability                     | Status                | Implementation Mechanism                                                                                        |
| :----------------------------- | :-------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **1. Broker-Only Tools**       | **PROVEN (Offline)**  | `.agents/hooks.json` `PreToolUse` hook denies all 57 native tools; allows only broker tools.                    |
| **2. Credential Isolation**    | **PROVEN (Offline)**  | Loopback proxy intercepts `CLOUD_CODE_URL`; runner receives no upstream cloud credentials.                      |
| **3. Hard Token Ceilings**     | **PROVEN (Offline)**  | Pre-request reservation on `ModelLedgerPort` drops requests exceeding allocation before generation.             |
| **4. Complete Accounting**     | **PROVEN (Offline)**  | Transport-level response inspection records exact prompt, completion, and reasoning tokens into durable ledger. |
| **5. Descendant Cancellation** | **PENDING CONTAINER** | Requires Docker container cgroup execution to isolate from macOS host process groups.                           |
