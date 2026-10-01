import { z } from "zod";

export const controlRunnerSchema = z.enum(["codex", "agy"]);
export type ControlRunner = z.infer<typeof controlRunnerSchema>;

export const controlCapabilitySchema = z.enum([
  "schema_bound_output",
  "broker_only_effects",
  "credential_network_separation",
  "container_boundary",
  "hard_token_ceiling",
  "complete_usage",
  "descendant_cancellation",
]);
export type ControlCapability = z.infer<typeof controlCapabilitySchema>;

export const controlObservationSchema = z.enum([
  "UNVERIFIED",
  "PASSED",
  "FAILED",
]);
export type ControlObservation = z.infer<typeof controlObservationSchema>;

// These facts are only metadata. They cannot satisfy a capability gate.
export const controlDiscoverySchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  kind: z.literal("runner_control_metadata"),
  runner: controlRunnerSchema,
  expected_version: z.string().regex(/^\d+\.\d+\.\d+[\w.-]*$/),
  observed_version: z.string().nullable(),
  executable_digest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  binary_unchanged: z.boolean(),
  steps: z
    .array(
      z.strictObject({
        id: z.enum(["version", "help", "features", "protocol_schema"]),
        attempted: z.boolean().nullable(),
        exit_code: z.number().int().nullable(),
        failure: z
          .enum([
            "LAUNCH_FAILED",
            "TIMED_OUT",
            "OUTPUT_LIMIT",
            "CANCELLED",
            "INVALID_PROTOCOL",
            "VERSION_MISMATCH",
            "BINARY_CHANGED",
            "INFRASTRUCTURE_FAILED",
          ])
          .nullable(),
      }),
    )
    .min(1)
    .max(4),
  known_features: z.strictObject({
    shell_tool: z.boolean().nullable(),
    unified_exec: z.boolean().nullable(),
    token_budget: z.boolean().nullable(),
    rollout_budget: z.boolean().nullable(),
  }),
  protocol_fields: z.strictObject({
    dynamic_tools: z.boolean(),
    output_schema: z.boolean(),
  }),
  capability_observations: z.record(
    controlCapabilitySchema,
    controlObservationSchema,
  ),
  enforced_conformance: z.literal(false),
});
export type ControlDiscovery = z.infer<typeof controlDiscoverySchema>;

export const controlCapabilities = controlCapabilitySchema.options;

export function unverifiedObservations(): Record<
  ControlCapability,
  ControlObservation
> {
  return {
    schema_bound_output: "UNVERIFIED",
    broker_only_effects: "UNVERIFIED",
    credential_network_separation: "UNVERIFIED",
    container_boundary: "UNVERIFIED",
    hard_token_ceiling: "UNVERIFIED",
    complete_usage: "UNVERIFIED",
    descendant_cancellation: "UNVERIFIED",
  };
}
