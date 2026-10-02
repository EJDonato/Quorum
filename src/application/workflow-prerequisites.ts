import { failure, type Outcome } from "../contracts/errors.js";
import type { OrchestratorOptions } from "./session-init.js";

export async function verifyWorkflowPrerequisites(
  options: OrchestratorOptions,
): Promise<Outcome<void>> {
  if (!options.verification)
    return failure(
      "CAPABILITY_MISSING",
      "Host preflight and evidence verification are required.",
    );
  const preflight = await options.verification.preflight();
  if (!preflight.ok) return preflight;
  if (!options.verification.testPreparation)
    return failure(
      "CAPABILITY_MISSING",
      "Host test-preparation evidence verification is required.",
    );
  if (
    !options.hooks.onPlan ||
    !options.hooks.onTestAuthor ||
    !options.hooks.onImplement ||
    !options.hooks.onValidate ||
    !options.hooks.onReview
  )
    return failure(
      "CAPABILITY_MISSING",
      "All required workflow stages must be installed.",
    );
  return { ok: true, value: undefined };
}
