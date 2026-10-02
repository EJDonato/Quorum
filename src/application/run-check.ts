import type { CheckResult } from "../contracts/checks.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import { randomUUID } from "node:crypto";
import { failure, type Outcome } from "../contracts/errors.js";
import { validationIntentSchema } from "../contracts/validation.js";
import { prepareValidation } from "./validation-input.js";
import { publishValidationResult } from "./validation-result.js";
import type { RunCheckOptions } from "./validation-ports.js";
export type {
  ValidationPorts,
  SandboxResult,
  RunCheckOptions,
} from "./validation-ports.js";
export { validationEnvironment } from "./validation-input.js";

export async function runConfiguredCheck(options: RunCheckOptions): Promise<
  Outcome<{
    execution_id: string;
    status: "PASSED" | "FAILED" | "BLOCKED";
    evidence_ref: string;
    record: CheckResult;
    reference: ArtifactReference;
  }>
> {
  options = { ...options, environment: { ...options.environment } };
  const ready = prepareValidation(options);
  if (!ready.ok) return ready;
  const grant = await options.ports.authorize();
  if (!grant.ok) return grant;
  if (!validRemainingMs(grant.value.remainingMs))
    return failure("BUDGET_EXHAUSTED", "Check budget is missing or exhausted.");
  const { config, command } = ready.value;
  const timeoutMs = Math.min(
    config.budgets.check_timeout_ms,
    grant.value.remainingMs,
    600_000,
  );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    return failure("BUDGET_EXHAUSTED", "No check execution time remains.");
  const intent = createIntent(options, ready.value, timeoutMs);
  if (!intent.success)
    return failure("INVALID_INPUT", "Invalid check invocation identity.");
  const persisted = await options.ports.persistIntent(intent.data);
  if (!persisted.ok) return persisted;
  const rechecked = await options.ports.authorize();
  if (!rechecked.ok) return rechecked;
  if (!validRemainingMs(rechecked.value.remainingMs))
    return failure("BUDGET_EXHAUSTED", "Check budget changed before dispatch.");
  const execution = await options.ports.execute({
    intent: intent.data,
    command,
    environment: options.environment,
    deadlineMs: Math.min(
      Date.parse(intent.data.started_at) + intent.data.timeout_ms,
      options.ports.now().getTime() + rechecked.value.remainingMs,
    ),
  });
  if (!execution.ok) return execution;
  if (!execution.value.cleanupConfirmed)
    return failure(
      "CAPABILITY_MISSING",
      "Container cleanup is unconfirmed; check cannot establish approval.",
    );
  return publishValidationResult({
    options,
    intent: intent.data,
    command,
    execution: execution.value,
  });
}

function validRemainingMs(remainingMs: number): boolean {
  return Number.isSafeInteger(remainingMs) && remainingMs > 0;
}

function createIntent(
  options: RunCheckOptions,
  ready: Extract<ReturnType<typeof prepareValidation>, { ok: true }>["value"],
  timeoutMs: number,
) {
  const { config, target, command } = ready;
  const id = randomUUID().replaceAll("-", "");
  const intent = validationIntentSchema.safeParse({
    schema_version: "1.0.0",
    execution_id: id,
    invocation_id: options.invocationId,
    session_id: target.sessionId,
    check_id: command.check_id,
    input: target.input,
    tree: target.tree,
    configuration_digest: ready.configDigest,
    command_digest: ready.commandDigest,
    environment_digest: ready.envDigest,
    image: config.validation_image,
    container_name: `quorum-check-${id}`,
    timeout_ms: timeoutMs,
    max_output_bytes: 1_000_000,
    started_at: options.ports.now().toISOString(),
  });
  return intent;
}
