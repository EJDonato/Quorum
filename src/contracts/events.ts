import { z } from "zod";
import {
  count,
  digest,
  opaqueId,
  positiveCount,
  schemaVersion,
  utcTimestamp,
} from "./primitives.js";
import { repairStageSchema } from "./session.js";

export const transitionInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("PREFLIGHT_COMPLETED") }),
  z.strictObject({
    type: z.literal("PLAN_ACCEPTED"),
    design_required: z.boolean(),
  }),
  z.strictObject({ type: z.literal("DESIGN_CLEARED") }),
  z.strictObject({ type: z.literal("TEST_SPEC_ACCEPTED") }),
  z.strictObject({ type: z.literal("CANDIDATE_FROZEN"), candidate_id: digest }),
  z.strictObject({ type: z.literal("CHECKS_COMPLETED") }),
  z.strictObject({
    type: z.literal("REPAIR_REQUESTED"),
    stage: repairStageSchema,
    reason: z.string().min(1).max(2048),
  }),
  z.strictObject({
    type: z.literal("BLOCK"),
    reason: z.string().min(1).max(2048),
  }),
  z.strictObject({
    type: z.literal("CANCEL"),
    reason: z.string().min(1).max(2048),
  }),
  z.strictObject({ type: z.literal("ABORT") }),
  z.strictObject({
    type: z.literal("RESUME"),
    stage: repairStageSchema,
    input_digest: digest,
  }),
  z.strictObject({ type: z.literal("RESERVE_TOKENS"), tokens: positiveCount }),
  z.strictObject({ type: z.literal("CHARGE_ACTIVE_TIME"), elapsed_ms: count }),
]);

export const eventSchema = z.strictObject({
  schema_version: schemaVersion,
  event_id: opaqueId,
  session_id: opaqueId,
  sequence: positiveCount,
  previous_digest: digest.nullable(),
  timestamp: utcTimestamp,
  payload: transitionInputSchema,
});

export type TransitionInput = z.infer<typeof transitionInputSchema>;
export type SessionEvent = z.infer<typeof eventSchema>;
