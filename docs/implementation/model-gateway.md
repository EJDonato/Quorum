# Host model gateway and durable request ceilings

Implemented on 2026-10-02 for PRD Section 3.1 and SYSTEM_DESIGN Section 5.2. **M0 remains blocked.** This slice implements the host gateway, durable invocation allocation and a bounded Responses transport. It does not enable either runtime runner adapter.

## Implemented behavior

`src/infrastructure/model-gateway/composition.ts` binds a validated host invocation, provider/model capability record, instructions, output ceiling and mode to an immutable allocation. It exposes host-only dispatch and budget inspection; these are not model-callable tools. The allocation uses `InvocationRequest.limits.tokens_reserved`. Production wiring must first reserve that allocation in the orchestrator's durable session budget and later reconcile its aggregate usage; that wiring is not supplied by this slice.

Runner input is strictly `{input: string}`. Model, instructions, identity, endpoint, credentials, token limits, tools and previous-response/conversation identifiers come from host policy or are unsupported. Text and instructions are bounded to 65,536 characters each. The counted payload is frozen and canonically hashed. The initial tool manifest is empty, and the transport rejects function/tool-call response items; broker tool iterations are a future integration boundary.

Dispatch follows this sequence:

1. Reject missing/unverified input/output limits. Enforced mode additionally requires the host to verify evidence for the exact capability record; a provider's own `verified` label is insufficient.
2. Acquire the host ledger lock and reconstruct charges from chained immutable events. Reject an already attempted request ID.
3. Recheck host authorization and obtain the exact count for the frozen model/instructions/input/tools payload. A different payload digest blocks dispatch.
4. Fsync a reservation for input count plus the configured output ceiling. Insufficient remaining allocation or a failed/ambiguous write prevents generation.
5. Recheck host authorization and cancellation, then send the same input payload with `max_output_tokens` and no tools, streaming, retained conversation or automatic truncation.
6. Validate model identity, completion status and complete usage. Cached input and reasoning tokens are subsets of input/output, not extra charges. Reconcile once; return incomplete responses as failures. Missing, invalid or over-ceiling accounting retains the full reservation and publishes no output.

Every explicit iteration or retry has a new host request ID and its own reservation. Reusing an attempted ID never regenerates a response, including after restart. The gateway performs no automatic retry; the orchestrator still owns the PRD's transport/repair retry allowances.

## Storage and credential boundary

`allocation.json` pins the session, invocation, token allocation and configuration context digest. Numbered immutable records under `events/` contain reservation or settlement metadata and the previous canonical digest. No prompt, response text or authentication header is written to this ledger. A command lock serializes effects; conflicting allocations, corrupt/missing/reordered events and uncertain writes block further dispatch. The ledger supports at most 4,096 events and reserves capacity for settlement. It lives in host-owned storage that must never be writable by runners.

The HTTP transport resolves credentials only at the host effect boundary and places them in Authorization headers. It does not read user credential files or environment variables. Diagnostics are fixed categories rather than upstream response bodies or exception messages. Fixture endpoints are restricted to explicit IPv4 loopback ports and require `QUORUM_FIXTURE_` credential canaries, preventing accidental transmission of a non-fixture credential to a local test endpoint. The unverified real endpoint is restricted to `https://api.openai.com/v1`; redirects and automatic application retries are disabled. Each response has a configured byte bound of at most 1 MiB and a transport deadline of at most 60 seconds.

The composition root also supplies an invocation deadline. Full session active-time accounting and deadline recovery remain orchestrator responsibilities. Provider usage reconciliation is conditional on valid, complete counts; this gateway does not promise detection of undisclosed upstream retries or consumption outside its transport.

## Evidence and provider status

The [official input-token counting documentation](https://developers.openai.com/api/docs/guides/token-counting) describes exact counts including request framing. The [Responses API output-limit contract](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) includes visible and reasoning output in `max_output_tokens`. These establish a candidate mechanism for the restricted payload, not verified support for the user's Codex ChatGPT account or selected model.

`createResponsesProvider` deliberately exposes only `fixture` and `unverified` statuses. Real-provider dispatch through the gateway fails before credential resolution or counting until a separately proven provider implementation/capability manifest is supplied and verified by the host. This change makes no API model call, authenticates no user account, installs no SDK and changes no requested model preference.

Offline fixtures use visibly synthetic tokenization: one canonical input byte is one fixture token. Tests inject fake transports and also exercise native HTTP against a local fake count/generation server. The latter verifies that the fake provider sees a durable reservation before generation, sees credentials only in headers, and returns normalized overlapping cache/reasoning usage. It is not evidence that a real provider obeys its documented limits.

## Verification and next boundary

Targeted tests cover exact payload binding, ceiling arithmetic, cache/reasoning normalization, incomplete and over-ceiling usage, denied caller authority, insufficient budgets, concurrent dispatch, restart/replay protection, authorization revocation, cancellation, corrupt/configuration-conflicting evidence, failed writes before/after durability, settlement failure, malformed/oversized HTTP output, credential rejection/redaction and disabled redirects. Routine tests are offline and use no paid provider.

The next assignment is to connect the observed Codex endpoint substitution to this budget boundary. That requires a pinned translation/counting contract for Codex's actual structured requests, host-owned broker tool definitions, every tool iteration/retry, and account/model authentication through the broker. The current text-only gateway cannot accept Codex's full raw Responses payload. Then prove the real pinned runner's credential/egress and descendant containment independently. Antigravity requires its own compatible transport and evidence. `doctor`, `test:conformance`, enforced runner dispatch and verified finalization remain blocked.
