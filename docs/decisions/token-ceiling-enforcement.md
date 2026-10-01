# Token ceiling enforcement and usage accounting

**Status:** Proposed fallback, not accepted as satisfying the PRD hard token ceiling. Enforced runner operation remains blocked.

## Context

PRD Section 3.1 states:

> "The adapter must expose usage and a hard per-request token ceiling; the orchestrator reserves that ceiling from the remaining budget before dispatch. Unsupported budget enforcement blocks enforced mode."

During M0 investigation on 2026-10-01:

1. **Codex CLI 0.159.3**: `--strict-config` invocations with `max_output_tokens=64` or `features.rollout_budget` exited 1. The protocol schemas (`ThreadStartParams` / `TurnStartParams`) expose `outputSchema` and `dynamicTools`, but neither exposes a pre-request provider token limit parameter.
2. **Antigravity CLI 1.2.14**: Exposes `--print-timeout` (wall clock), but no pre-request token limit flag.

Both runners successfully report structured usage upon completion:

- Codex reports `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`.
- Antigravity reports `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens`.

Neither provider CLI supports a pre-flight provider-side refusal flag if the request might exceed a token threshold.

## Proposed fallback: host reservation and reconciled accounting

The pure budget ledger implements reservation and reconciliation for supplied events. Wiring it to actual runner dispatch is pending. The proposed fallback is:

1. **Pre-Dispatch Host Reservation**:
   - Before any runner invocation, the orchestrator checks remaining session and stage token budgets (`domain/budgets.ts`).
   - The orchestrator reserves the required token ceiling from the available budget.
   - If remaining budget is less than the required reservation, dispatch is blocked immediately. No model call occurs.

2. **Durable Intent Logging**:
   - The token reservation is recorded in the session's durable journal (`intent.json` / `events.jsonl`) before scheduling the runner process.
   - Reservations survive crashes, cancellations, and restarts.

3. **Post-Invocation Reconciliation**:
   - Upon process completion, the orchestrator validates the runner's structured usage against `usageSchema`.
   - If the invocation succeeds within budget, the actual reported tokens are charged and unspent reservations are returned to the pool.
   - If reported tokens exceed the reservation or remaining budget, the session immediately enters `BLOCKED` status with `BUDGET_EXHAUSTED`.
   - Any generated candidate from an over-budget invocation is immediately rejected and cannot be approved or committed.

4. **Interrupted or Missing Accounting**:
   - If an invocation crashes, times out, or fails to report usage, the entire reserved token ceiling remains charged permanently to prevent budget erasure through repeated crashes.

## Conclusion for M0

Reservation and post-request reconciliation cannot prevent a provider from consuming more than the reservation. They therefore do not satisfy the required hard per-request ceiling. Usage reporting proves accounting visibility only. Enforced dispatch must stay blocked until a real ceiling is demonstrated or the user explicitly changes the product requirement; this document does not authorize that change.
