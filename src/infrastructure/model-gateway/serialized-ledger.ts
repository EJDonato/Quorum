import type {
  ModelLedgerPort,
  ModelLedgerTransaction,
} from "../../application/model-gateway-ports.js";
import { failure, type Outcome } from "../../contracts/errors.js";

export function serializeModelLedger(
  ledger: ModelLedgerPort,
  maxPending: number,
): ModelLedgerPort {
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    exclusive<T>(
      operation: (transaction: ModelLedgerTransaction) => Promise<Outcome<T>>,
    ): Promise<Outcome<T>> {
      if (pending >= maxPending)
        return Promise.resolve(
          failure("LOCKED", "Model request queue is full."),
        );
      pending++;
      const result = tail.then(() => ledger.exclusive(operation));
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => pending--);
    },
  };
}
