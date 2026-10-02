import type { Outcome } from "../contracts/errors.js";
import type { GatewayEvent, ModelPayload } from "../contracts/model-gateway.js";
import type { ModelBudgetState } from "../domain/model-budget.js";

export interface ModelProviderPort {
  capability: unknown;
  countInput(
    payload: Readonly<ModelPayload>,
    signal: AbortSignal,
  ): Promise<Outcome<unknown>>;
  generate(options: {
    payload: Readonly<ModelPayload>;
    signal: AbortSignal;
  }): Promise<Outcome<unknown>>;
}
export interface ModelLedgerTransaction {
  state: ModelBudgetState;
  sequence: number;
  previousDigest: string;
  append(event: GatewayEvent): Promise<Outcome<void>>;
}
export interface ModelLedgerPort {
  exclusive<T>(
    operation: (transaction: ModelLedgerTransaction) => Promise<Outcome<T>>,
  ): Promise<Outcome<T>>;
}
