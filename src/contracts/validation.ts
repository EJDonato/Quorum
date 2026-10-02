import { z } from "zod";
import {
  count,
  digest,
  gitObject,
  opaqueId,
  positiveCount,
  schemaVersion,
  utcTimestamp,
  versionLabel,
} from "./primitives.js";
import { checkResultSchema } from "./checks.js";

// One complete tool report on stdout; process status is attached by the host.
export const validationReportSchema = z.strictObject({
  schema_version: schemaVersion,
  report_complete: z.boolean(),
  discovered_tests: count.nullable(),
  error_count: count,
  warning_count: count,
  failure_class: z
    .enum(["behavioral", "compiler", "infrastructure"])
    .nullable(),
  tool_version: versionLabel,
  failure_ids: z.array(opaqueId).max(256).optional(),
  fuzz: z
    .strictObject({
      seed: count,
      cases_required: positiveCount,
      cases_completed: count,
    })
    .nullable(),
});
export const validationIntentSchema = z
  .strictObject({
    schema_version: schemaVersion,
    execution_id: opaqueId,
    invocation_id: opaqueId,
    session_id: opaqueId,
    check_id: opaqueId,
    input: checkResultSchema.shape.input,
    tree: gitObject,
    configuration_digest: digest,
    command_digest: digest,
    environment_digest: digest,
    image: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
    container_name: z.string().regex(/^quorum-check-[a-f0-9]{32}$/),
    timeout_ms: positiveCount.max(600_000),
    max_output_bytes: positiveCount.max(1_000_000),
    started_at: utcTimestamp,
  })
  .superRefine((intent, context) => {
    if (intent.container_name !== `quorum-check-${intent.execution_id}`)
      context.addIssue({
        code: "custom",
        message: "Container identity differs from execution identity",
      });
  });
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ValidationIntent = z.infer<typeof validationIntentSchema>;
