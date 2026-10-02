import { z } from "zod";
import {
  agyProbeFailureSchema,
  agyUsageSchema,
} from "./agy-offline-protocol.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const agyOfflineReportSchema = z.strictObject({
  kind: z.literal("agy_offline_protocol"),
  schema_version: z.literal("1.0.0"),
  expected_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  failure: z
    .union([
      agyProbeFailureSchema,
      z.enum([
        "INFRASTRUCTURE_FAILED",
        "BINARY_CHANGED",
        "AUTH_REQUIRED",
        "TOOL_ENFORCEMENT_FAILED",
      ]),
    ])
    .nullable(),
  failure_stage: z
    .enum(["platform", "isolation_setup", "version", "protocol"])
    .optional(),
  enforced_conformance: z.literal(false),
  external_model_attempts: z.literal(0),
  initialized: z.boolean(),
  completed: z.boolean(),
  effective_tool_inventory: z.array(z.string().max(128)).max(256).nullable(),
  native_tool_count: z.number().int().nonnegative().nullable(),
  broker_tools_exclusive: z.boolean(),
  usage: agyUsageSchema.nullable(),
  mandatory_capabilities: z.literal("UNVERIFIED"),
  observed_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  executable_digest: digest.optional(),
  binary_unchanged: z.boolean().optional(),
  sandbox_digest: digest.optional(),
  events: z.array(z.string().max(64)).max(256).optional(),
  exit_code: z.number().int().nullable().optional(),
  cleanup: z.literal("PROCESS_GROUP_ONLY_UNVERIFIED").optional(),
});

export type AgyOfflineReport = z.infer<typeof agyOfflineReportSchema>;
