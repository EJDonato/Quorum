import type {
  GatewayAllocation,
  GatewayEvent,
  ModelReservation,
} from "../contracts/model-gateway.js";
import type { ModelUsage } from "../contracts/model-gateway.js";
import { failure, type Outcome } from "../contracts/errors.js";

export interface ModelBudgetState {
  tokensCharged: number;
  requests: Map<
    string,
    { reservation: ModelReservation; usage: ModelUsage | null }
  >;
}

export function applyModelBudgetEvent(options: {
  allocation: GatewayAllocation;
  state: ModelBudgetState;
  event: GatewayEvent;
}): Outcome<ModelBudgetState> {
  const { allocation, state, event } = options;
  const requests = new Map(state.requests);
  if (event.kind === "reserved") {
    const r = event.reservation;
    if (requests.has(r.request_id))
      return failure(
        "STALE_INPUT",
        "Model request ID was already reserved; replay is forbidden.",
      );
    if (r.tokens_reserved > allocation.tokens_limit - state.tokensCharged)
      return failure(
        "BUDGET_EXHAUSTED",
        "Model request ceiling exceeds its durable invocation allocation.",
      );
    requests.set(r.request_id, { reservation: r, usage: null });
    return {
      ok: true,
      value: {
        requests,
        tokensCharged: state.tokensCharged + r.tokens_reserved,
      },
    };
  }
  const existing = requests.get(event.request_id);
  if (!existing || existing.usage)
    return failure(
      "EVIDENCE_INVALID",
      "Unknown or already reconciled model reservation.",
    );
  const r = existing.reservation;
  const u = event.usage;
  if (
    !u.accounting_complete ||
    u.input_tokens > r.input_tokens_bound ||
    u.output_tokens > r.output_tokens_limit ||
    u.charged_tokens !== u.input_tokens + u.output_tokens
  )
    return failure(
      "EVIDENCE_INVALID",
      "Usage is incomplete or violates the provider request bound.",
    );
  requests.set(event.request_id, { reservation: r, usage: u });
  return {
    ok: true,
    value: {
      requests,
      tokensCharged: state.tokensCharged - r.tokens_reserved + u.charged_tokens,
    },
  };
}
