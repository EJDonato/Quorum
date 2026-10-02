import type { ArtifactReference } from "../contracts/ballot-input.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { InvocationRequest, RolePhase } from "../contracts/invocation.js";
import type { WorkspacePaths } from "../infrastructure/workspace/manager.js";
import { validateInvocationResult } from "../domain/invocations.js";
import type { RunnerAdapter } from "./runner-ports.js";
import type { OrchestrationHooks } from "./session-init.js";

export interface RunnerDispatchOptions {
  adapter: RunnerAdapter;
  sessionId: string;
  inputDigest: string;
  responseSchemaRef: ArtifactReference;
  timeoutMs?: number;
  tokensReserved?: number;
}

export function createRunnerOrchestrationHooks(
  options: RunnerDispatchOptions,
): OrchestrationHooks {
  return {
    onPlan: (workspace) =>
      dispatchRole({
        options,
        assignment: { phase: "planning", role: "planner" },
        workspace,
      }),
    onTestAuthor: (workspace) =>
      dispatchRole({
        options,
        assignment: { phase: "test_authoring", role: "qa" },
        writePaths: ["tests/**"],
        workspace,
      }),
    onImplement: (workspace) =>
      dispatchRole({
        options,
        assignment: { phase: "implementation", role: "developer" },
        writePaths: ["src/**"],
        workspace,
      }),
    onReview: (workspace, candidateId) =>
      dispatchRole({
        options,
        assignment: {
          phase: "final",
          role: "qa",
          candidate_id: candidateId,
        },
        workspace,
      }),
  };
}

async function dispatchRole(input: {
  options: RunnerDispatchOptions;
  assignment: RolePhase;
  writePaths?: string[];
  workspace?: WorkspacePaths;
}): Promise<Outcome<void>> {
  const { options, assignment, writePaths = [], workspace } = input;
  const request = buildInvocationRequest(options, assignment, writePaths);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    const invoked = await options.adapter.invoke(
      request,
      controller.signal,
      workspace,
    );
    if (!invoked.ok) return invoked;
    const validated = validateInvocationResult(request, invoked.value);
    if (!validated.ok) return validated;
    if (validated.value.execution_status !== "SUCCEEDED") {
      return failure(
        "CHECK_FAILED",
        validated.value.error?.message ?? "Role execution failed",
      );
    }
    return { ok: true, value: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

function buildInvocationRequest(
  options: RunnerDispatchOptions,
  assignment: RolePhase,
  writePaths: string[],
): InvocationRequest {
  const isWritable =
    assignment.phase === "test_authoring" ||
    assignment.phase === "implementation";
  const tools: InvocationRequest["grants"]["tools"] = isWritable
    ? [
        "repo.read",
        "repo.search",
        "draft.apply_patch",
        "checks.run",
        "role.submit",
      ]
    : ["repo.read", "repo.search", "artifact.read", "role.submit"];

  return {
    protocol_version: "1.0.0",
    invocation_id: `inv-${assignment.role}-${assignment.phase}`,
    session_id: options.sessionId,
    task_id: null,
    assignment,
    input_digest: options.inputDigest,
    input_refs: [options.responseSchemaRef],
    grants: {
      tools,
      read_paths: ["*"],
      write_paths: isWritable ? writePaths : [],
      check_ids: [],
    },
    response_schema_ref: options.responseSchemaRef,
    limits: {
      timeout_ms: options.timeoutMs ?? 60_000,
      tokens_reserved: options.tokensReserved ?? 10_000,
    },
  };
}
