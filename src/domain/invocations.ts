import {
  invocationRequestSchema,
  invocationResultSchema,
  type InvocationResult,
} from "../contracts/invocation.js";
import { failure, type Outcome } from "../contracts/errors.js";

export function validateInvocationResult(
  rawRequest: unknown,
  rawResult: unknown,
): Outcome<InvocationResult> {
  const request = invocationRequestSchema.safeParse(rawRequest);
  const result = invocationResultSchema.safeParse(rawResult);
  if (!request.success || !result.success)
    return failure("INVALID_INPUT", "Malformed invocation request or result.");
  if (
    request.data.invocation_id !== result.data.invocation_id ||
    request.data.session_id !== result.data.session_id ||
    request.data.input_digest !== result.data.input_digest
  ) {
    return failure(
      "EVIDENCE_INVALID",
      "Invocation result does not match host identity or input.",
    );
  }
  if (
    result.data.usage !== null &&
    result.data.usage.charged_tokens > request.data.limits.tokens_reserved
  ) {
    return failure(
      "BUDGET_EXHAUSTED",
      "Reported usage exceeds the host reservation.",
    );
  }
  return { ok: true, value: result.data };
}
