import type { Outcome } from "../../../contracts/errors.js";
import type { ModelUsage } from "../../../contracts/model-gateway.js";
import type { ModelLedgerTransaction } from "../../../application/model-gateway-ports.js";

export function appendAgySettlement(
  transaction: ModelLedgerTransaction,
  requestId: string,
  usage: ModelUsage,
): Promise<Outcome<void>> {
  return transaction.append({
    schema_version: "1.0.0",
    kind: "settled",
    sequence: transaction.sequence + 1,
    previous_digest: transaction.previousDigest,
    request_id: requestId,
    usage,
  });
}
