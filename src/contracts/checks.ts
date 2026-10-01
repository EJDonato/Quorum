import { z } from "zod";
import {
  artifactReference,
  count,
  digest,
  executionStatus,
  opaqueId,
  schemaVersion,
  utcTimestamp,
  versionLabel,
} from "./primitives.js";

export const checkResultSchema = z
  .strictObject({
    schema_version: schemaVersion,
    check_result_id: opaqueId,
    session_id: opaqueId,
    check_id: opaqueId,
    input: z.discriminatedUnion("phase", [
      z.strictObject({ phase: z.literal("baseline"), input_digest: digest }),
      z.strictObject({
        phase: z.literal("expected_red"),
        input_digest: digest,
      }),
      z.strictObject({ phase: z.literal("final"), candidate_id: digest }),
    ]),
    kind: z.enum([
      "test",
      "lint",
      "typecheck",
      "documentation",
      "scanner",
      "fuzz",
    ]),
    execution_status: executionStatus,
    exit_code: z.number().int().min(0).max(255).nullable(),
    duration_ms: count,
    started_at: utcTimestamp,
    ended_at: utcTimestamp,
    command_digest: digest,
    environment_digest: digest,
    tool_version: versionLabel,
    stdout_ref: artifactReference,
    stderr_ref: artifactReference,
    report_complete: z.boolean(),
    discovered_tests: count.nullable(),
    error_count: count,
    warning_count: count,
    failure_class: z
      .enum(["behavioral", "compiler", "infrastructure"])
      .nullable(),
    fuzz: z
      .strictObject({
        seed: count,
        cases_required: count.min(1),
        cases_completed: count,
      })
      .nullable(),
  })
  .superRefine((result, context) => {
    if (Date.parse(result.ended_at) < Date.parse(result.started_at))
      context.addIssue({
        code: "custom",
        message: "Check ends before it starts",
      });
    if (result.execution_status === "SUCCEEDED" && result.exit_code === null)
      context.addIssue({
        code: "custom",
        message: "Completed check requires exit code",
      });
    if ((result.kind === "fuzz") !== (result.fuzz !== null))
      context.addIssue({
        code: "custom",
        message: "Fuzz counts required only for fuzz checks",
      });
  });

export type CheckResult = z.infer<typeof checkResultSchema>;
