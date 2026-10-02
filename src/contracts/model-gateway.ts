import { z } from "zod";
import {
  count,
  digest,
  opaqueId,
  positiveCount,
  schemaVersion,
  versionLabel,
} from "./primitives.js";
import { usageSchema } from "./invocation.js";

// Host-only service contracts. Runner input cannot choose identity, model, tools or limits.
export const modelInputSchema = z.strictObject({
  input: z.string().min(1).max(65536),
});
export const modelPayloadSchema = z.strictObject({
  model: versionLabel,
  instructions: z.string().max(65536),
  input: z.string().min(1).max(65536),
  tools: z.array(z.never()).length(0),
  max_output_tokens: positiveCount,
  stream: z.literal(false),
  store: z.literal(false),
  truncation: z.literal("disabled"),
  tool_choice: z.literal("none"),
  parallel_tool_calls: z.literal(false),
});
export const modelCapabilitySchema = z.strictObject({
  schema_version: schemaVersion,
  provider: versionLabel,
  model: versionLabel,
  status: z.enum(["fixture", "unverified", "verified"]),
  input_bound: z.enum(["exact_payload", "unsupported"]),
  output_bound: z.enum(["includes_reasoning", "unsupported"]),
  hidden_retries: z.literal(false),
  evidence_digest: digest.nullable(),
});
export const modelCountSchema = z.strictObject({
  payload_digest: digest,
  input_tokens: count,
});
export const gatewayAllocationSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  invocation_id: opaqueId,
  tokens_limit: positiveCount,
  context_digest: digest,
});
export const modelReservationSchema = z
  .strictObject({
    request_id: opaqueId,
    payload_digest: digest,
    capability_digest: digest,
    input_tokens_bound: count,
    output_tokens_limit: positiveCount,
    tokens_reserved: positiveCount,
  })
  .refine(
    (r) =>
      Number.isSafeInteger(r.input_tokens_bound + r.output_tokens_limit) &&
      r.tokens_reserved === r.input_tokens_bound + r.output_tokens_limit,
  );
export const gatewayEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schema_version: schemaVersion,
    sequence: positiveCount,
    previous_digest: digest,
    kind: z.literal("reserved"),
    reservation: modelReservationSchema,
  }),
  z.strictObject({
    schema_version: schemaVersion,
    sequence: positiveCount,
    previous_digest: digest,
    kind: z.literal("settled"),
    request_id: opaqueId,
    usage: usageSchema,
  }),
]);
export const modelCompletionSchema = z.strictObject({
  payload_digest: digest,
  status: z.enum(["completed", "incomplete"]),
  output: z.string().max(65536),
  usage: usageSchema,
});
export type ModelPayload = z.infer<typeof modelPayloadSchema>;
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;
export type ModelReservation = z.infer<typeof modelReservationSchema>;
export type GatewayAllocation = z.infer<typeof gatewayAllocationSchema>;
export type GatewayEvent = z.infer<typeof gatewayEventSchema>;
export type ModelCompletion = z.infer<typeof modelCompletionSchema>;
export type ModelUsage = z.infer<typeof usageSchema>;
