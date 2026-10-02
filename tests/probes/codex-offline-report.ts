import { z } from "zod";
import { probeFailureSchema, usageSchema } from "./codex-offline-protocol.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const offlineReportSchema = z.strictObject({
  kind: z.literal("codex_offline_protocol"),
  schema_version: z.literal("1.0.0"),
  expected_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  failure: z
    .union([
      probeFailureSchema,
      z.enum([
        "INFRASTRUCTURE_FAILED",
        "BINARY_CHANGED",
        "INVALID_PROVIDER_TRAFFIC",
      ]),
    ])
    .nullable(),
  failure_stage: z
    .enum(["platform", "isolation_setup", "version", "schemas", "protocol"])
    .optional(),
  enforced_conformance: z.literal(false),
  external_model_attempts: z.literal(0),
  initialized: z.boolean(),
  registered: z.boolean(),
  completed: z.boolean(),
  effective_tool_inventory: z.null(),
  usage: usageSchema.nullable(),
  provider_requests: z
    .array(
      z.strictObject({
        tools: z.array(z.string().max(257)).max(16384),
        max_output_tokens: z.number().int().positive().nullable(),
        hard_total_ceiling_verified: z.literal(false),
      }),
    )
    .max(1),
  mandatory_capabilities: z.literal("UNVERIFIED"),
  observed_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  executable_digest: digest.optional(),
  binary_unchanged: z.boolean().optional(),
  protocol_digests: z.record(z.string(), digest).optional(),
  config_digest: digest.optional(),
  sandbox_digest: digest.optional(),
  notifications: z
    .array(
      z.enum([
        "thread/started",
        "thread/tokenUsage/updated",
        "turn/started",
        "turn/completed",
        "remoteControl/status/changed",
        "error",
        "other",
      ]),
    )
    .max(256)
    .optional(),
  rejected_provider_requests: z.number().int().nonnegative().optional(),
  exit_code: z.number().int().nullable().optional(),
  cleanup: z.literal("PROCESS_GROUP_ONLY_UNVERIFIED").optional(),
});
