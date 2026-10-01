import type { RepairStage, SessionState } from "../contracts/session.js";
import { failure, type Outcome } from "../contracts/errors.js";

export function chargeRepair(
  session: SessionState,
  stage: RepairStage,
): Outcome<SessionState["budget"]> {
  const ledger = session.budget;
  if (
    ledger.repairs_total >= session.limits.repairs_total ||
    ledger.repairs_by_stage[stage] >= session.limits.repairs_per_stage
  ) {
    return failure(
      "BUDGET_EXHAUSTED",
      `Repair allowance exhausted for ${stage}.`,
    );
  }
  return {
    ok: true,
    value: {
      ...ledger,
      repairs_total: ledger.repairs_total + 1,
      repairs_by_stage: {
        ...ledger.repairs_by_stage,
        [stage]: ledger.repairs_by_stage[stage] + 1,
      },
    },
  };
}

export function reserveTokens(
  session: SessionState,
  tokens: number,
): Outcome<SessionState["budget"]> {
  if (tokens > session.limits.model_tokens - session.budget.tokens_charged) {
    return failure(
      "BUDGET_EXHAUSTED",
      "Request ceiling exceeds the remaining model token budget.",
    );
  }
  // Reservations remain fully charged after interruption until usage is reconciled.
  return {
    ok: true,
    value: {
      ...session.budget,
      tokens_charged: session.budget.tokens_charged + tokens,
    },
  };
}

export function chargeActiveTime(
  session: SessionState,
  elapsedMs: number,
): Outcome<SessionState["budget"]> {
  const remaining = Math.max(
    0,
    session.limits.active_session_ms - session.budget.active_elapsed_ms,
  );
  if (elapsedMs >= remaining)
    return failure("BUDGET_EXHAUSTED", "Active session deadline reached.");
  return {
    ok: true,
    value: {
      ...session.budget,
      active_elapsed_ms: session.budget.active_elapsed_ms + elapsedMs,
    },
  };
}
