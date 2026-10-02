import type { RepositoryConfig } from "../contracts/config.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import { checkResultSchema } from "../contracts/checks.js";
import { failure } from "../contracts/errors.js";
import {
  validationReportSchema,
  type ValidationIntent,
} from "../contracts/validation.js";
import { checkPassed } from "../domain/checks.js";
import type { RunCheckOptions, SandboxResult } from "./validation-ports.js";
export async function publishValidationResult(input: {
  options: RunCheckOptions;
  intent: ValidationIntent;
  command: RepositoryConfig["commands"][number];
  execution: SandboxResult;
}) {
  const { options, intent, command, execution } = input;
  const kind = command.kind;
  const ended = options.ports.now();
  let report: unknown;
  try {
    report = JSON.parse(execution.stdout);
  } catch {
    report = null;
  }
  const parsed = validationReportSchema.safeParse(report);
  const body = parsed.success ? parsed.data : null;
  const complete =
    execution.status === "SUCCEEDED" &&
    body?.report_complete === true &&
    (kind === "fuzz") === (body.fuzz !== null) &&
    (kind !== "fuzz" ||
      (body.fuzz?.seed === command.fuzz?.seed &&
        body.fuzz?.cases_required === command.fuzz?.cases_required));
  const streams = {
    stdout: sanitize(execution.stdout, options.environment),
    stderr: sanitize(execution.stderr, options.environment),
  };
  const refs = await options.ports.persistStreams(intent.execution_id, streams);
  if (!refs.ok) return refs;
  const record = buildRecord({
    ...input,
    refs: refs.value,
    body,
    complete,
    ended,
  });
  if (!record.success)
    return failure(
      "EVIDENCE_INVALID",
      "Execution violated its check contract.",
    );
  const stored = await options.ports.persistResult(record.data);
  if (!stored.ok) return stored;
  const status = checkPassed(record.data)
    ? ("PASSED" as const)
    : complete
      ? ("FAILED" as const)
      : ("BLOCKED" as const);
  return {
    ok: true as const,
    value: {
      execution_id: intent.execution_id,
      status,
      evidence_ref: stored.value.artifact_id,
      record: record.data,
      reference: stored.value,
    },
  };
}

function sanitize(text: string, environment: Record<string, string>): string {
  let redacted = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "?");
  for (const value of Object.values(environment))
    if (value) redacted = redacted.replaceAll(value, "[REDACTED]");
  return redacted;
}

function buildRecord(input: {
  options: RunCheckOptions;
  intent: ValidationIntent;
  command: RepositoryConfig["commands"][number];
  execution: SandboxResult;
  refs: { stdout: ArtifactReference; stderr: ArtifactReference };
  body: ReturnType<typeof validationReportSchema.parse> | null;
  complete: boolean;
  ended: Date;
}) {
  const { intent, command, execution, refs, body, complete, ended } = input;
  const kind = command.kind;
  return checkResultSchema.safeParse({
    schema_version: "1.0.0",
    check_result_id: intent.execution_id,
    session_id: intent.session_id,
    check_id: intent.check_id,
    input: intent.input,
    kind,
    execution_status: complete
      ? "SUCCEEDED"
      : execution.status === "SUCCEEDED"
        ? "PROTOCOL_ERROR"
        : execution.status,
    exit_code: execution.exitCode,
    duration_ms: Math.max(0, ended.getTime() - Date.parse(intent.started_at)),
    started_at: intent.started_at,
    ended_at: ended.toISOString(),
    command_digest: intent.command_digest,
    environment_digest: intent.environment_digest,
    tool_version: sanitize(
      body?.tool_version ?? "unavailable",
      input.options.environment,
    ),
    stdout_ref: refs.stdout,
    stderr_ref: refs.stderr,
    report_complete: complete,
    discovered_tests: body?.discovered_tests ?? null,
    error_count: body?.error_count ?? 0,
    warning_count: body?.warning_count ?? 0,
    failure_class: complete ? (body?.failure_class ?? null) : "infrastructure",
    fuzz:
      kind === "fuzz"
        ? (body?.fuzz ?? { ...command.fuzz, cases_completed: 0 })
        : null,
  });
}
