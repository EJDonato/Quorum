import { z } from "zod";
import { errorSchema } from "./errors.js";
import {
  artifactReference,
  count,
  digest,
  executionStatus,
  opaqueId,
  positiveCount,
  repositoryPath,
  schemaVersion,
  utcTimestamp,
} from "./primitives.js";

export const rolePhaseSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("planning"), role: z.literal("planner") }),
  z.strictObject({
    phase: z.literal("architecture"),
    role: z.literal("architect"),
  }),
  z.strictObject({ phase: z.literal("design"), role: z.literal("security") }),
  z.strictObject({ phase: z.literal("test_authoring"), role: z.literal("qa") }),
  z.strictObject({
    phase: z.literal("implementation"),
    role: z.enum(["developer", "refactor"]),
  }),
  z.strictObject({
    phase: z.literal("final"),
    role: z.enum(["qa", "security"]),
    candidate_id: digest,
  }),
]);

export const toolNameSchema = z.enum([
  "repo.read",
  "repo.search",
  "artifact.read",
  "draft.apply_patch",
  "checks.run",
  "role.submit",
  "scope.request",
]);

export const invocationRequestSchema = z
  .strictObject({
    protocol_version: schemaVersion,
    invocation_id: opaqueId,
    session_id: opaqueId,
    task_id: opaqueId.nullable(),
    assignment: rolePhaseSchema,
    input_digest: digest,
    input_refs: z.array(artifactReference).min(1).max(256),
    grants: z.strictObject({
      tools: z.array(toolNameSchema).min(1).max(7),
      read_paths: z.array(repositoryPath).max(256),
      write_paths: z.array(repositoryPath).max(256),
      check_ids: z.array(opaqueId).max(64),
    }),
    response_schema_ref: artifactReference,
    limits: z.strictObject({
      timeout_ms: positiveCount,
      tokens_reserved: positiveCount,
    }),
  })
  .superRefine((request, context) => {
    if (new Set(request.grants.tools).size !== request.grants.tools.length) {
      context.addIssue({ code: "custom", message: "Duplicate tool grants" });
    }
    const writable = ["test_authoring", "implementation"].includes(
      request.assignment.phase,
    );
    if (
      !writable &&
      (request.grants.write_paths.length > 0 ||
        request.grants.tools.includes("draft.apply_patch"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Read-only phase cannot receive mutation grants",
      });
    }
  });

export const usageSchema = z
  .strictObject({
    input_tokens: count,
    output_tokens: count,
    cached_input_tokens: count,
    reasoning_tokens: count,
    charged_tokens: count,
    accounting_complete: z.boolean(),
  })
  .superRefine((usage, context) => {
    if (
      usage.cached_input_tokens > usage.input_tokens ||
      usage.reasoning_tokens > usage.output_tokens ||
      usage.charged_tokens < usage.input_tokens + usage.output_tokens ||
      !Number.isSafeInteger(usage.input_tokens + usage.output_tokens)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid conservative usage accounting",
      });
    }
  });

export const invocationResultSchema = z
  .strictObject({
    protocol_version: schemaVersion,
    invocation_id: opaqueId,
    session_id: opaqueId,
    input_digest: digest,
    execution_status: executionStatus,
    usage: usageSchema.nullable(),
    output_ref: artifactReference.nullable(),
    error: errorSchema.nullable(),
    started_at: utcTimestamp,
    ended_at: utcTimestamp,
  })
  .superRefine((result, context) => {
    if (Date.parse(result.ended_at) < Date.parse(result.started_at))
      context.addIssue({
        code: "custom",
        message: "Invocation ends before it starts",
      });
    if (
      result.execution_status === "SUCCEEDED" &&
      (result.output_ref === null ||
        result.error !== null ||
        result.usage === null ||
        !result.usage.accounting_complete)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed invocation requires output and complete usage",
      });
    }
    if (result.execution_status !== "SUCCEEDED" && result.error === null) {
      context.addIssue({
        code: "custom",
        message: "Incomplete execution requires a normalized error",
      });
    }
  });

export type InvocationRequest = z.infer<typeof invocationRequestSchema>;
export type InvocationResult = z.infer<typeof invocationResultSchema>;
