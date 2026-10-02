import {
  checksRunInputSchema,
  checksRunOutputSchema,
} from "../contracts/tools.js";
import { failure } from "../contracts/errors.js";
import type { BrokerSessionContext } from "./broker.js";

export async function executeGrantedCheck(
  context: BrokerSessionContext,
  params: unknown,
) {
  const input = checksRunInputSchema.safeParse(params);
  if (!input.success)
    return failure("INVALID_INPUT", "Invalid checks.run input.");
  const checks = context.checks;
  if (!checks)
    return failure(
      "CAPABILITY_MISSING",
      "No isolated check executor is installed.",
    );
  if (
    checks.sessionId !== context.sessionId ||
    checks.invocationId !== context.invocationId
  )
    return failure(
      "SCOPE_DENIED",
      "Check executor belongs to another invocation.",
    );
  if (input.data.input_digest !== checks.inputDigest)
    return failure(
      "STALE_INPUT",
      "Check input differs from the granted revision.",
    );
  if (!checks.grantedCheckIds.includes(input.data.check_id))
    return failure("SCOPE_DENIED", "Check is not granted to this invocation.");
  const result = await checks.run(input.data.check_id);
  if (!result.ok) return result;
  const output = checksRunOutputSchema.safeParse(result.value);
  return output.success
    ? { ok: true as const, value: output.data }
    : failure(
        "EVIDENCE_INVALID",
        "Executor returned invalid check references.",
      );
}
