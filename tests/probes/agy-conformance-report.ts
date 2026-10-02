import { z } from "zod";
import { agyUsageSchema } from "./agy-offline-protocol.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const agyConformanceReportSchema = z.strictObject({
  kind: z.literal("agy_offline_conformance"),
  schema_version: z.literal("1.0.0"),
  expected_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  observed_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/u)
    .optional(),
  executable_digest: digest.optional(),
  binary_unchanged: z.boolean().optional(),
  config_digest: digest.optional(),
  hooks_digest: digest.optional(),
  sandbox_digest: digest.optional(),
  external_model_attempts: z.literal(0),
  local_provider_requests: z.number().int().nonnegative().max(4),
  proxy_requests: z.number().int().nonnegative().max(4),
  ledger_events: z.number().int().nonnegative().max(8),
  rejected_provider_requests: z.number().int().nonnegative(),
  provider_paths: z.array(z.string().max(256)).max(4),
  runner_sentinel_configured: z.boolean(),
  upstream_fixture_credential_only: z.boolean(),
  hook_observed: z.boolean(),
  denied_tool: z.literal("run_command").nullable(),
  denied_effect_absent: z.boolean(),
  completed: z.boolean(),
  usage: agyUsageSchema.nullable(),
  direct_gemini_route: z.boolean(),
  cloud_code_route: z.literal(false),
  failure: z
    .enum([
      "INFRASTRUCTURE_FAILED",
      "VERSION_MISMATCH",
      "PROVIDER_TRAFFIC_INVALID",
      "HOOK_NOT_OBSERVED",
      "DENIED_EFFECT_EXECUTED",
      "RUNNER_FAILED",
    ])
    .nullable(),
  failure_stage: z
    .enum(["platform", "setup", "version", "runner", "evidence"])
    .optional(),
  enforced_conformance: z.literal(false),
  mandatory_capabilities: z.literal("PARTIAL"),
});

export type AgyConformanceReport = z.infer<typeof agyConformanceReportSchema>;
