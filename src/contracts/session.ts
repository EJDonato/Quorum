import { z } from "zod";
import { budgetLimitsSchema } from "./config.js";
import {
  count,
  digest,
  gitObject,
  opaqueId,
  schemaVersion,
} from "./primitives.js";

export const stageSchema = z.enum([
  "PREFLIGHT",
  "PLANNING",
  "DESIGN_REVIEW",
  "TEST_SPEC",
  "IMPLEMENTING",
  "VALIDATING",
  "REVIEWING",
  "APPROVED",
  "FINALIZING",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
  "ABORTED",
]);
export const repairStageSchema = z.enum([
  "PLANNING",
  "DESIGN_REVIEW",
  "TEST_SPEC",
  "IMPLEMENTING",
  "VALIDATING",
  "REVIEWING",
]);
export const budgetLedgerSchema = z
  .strictObject({
    repairs_by_stage: z.strictObject({
      PLANNING: count,
      DESIGN_REVIEW: count,
      TEST_SPEC: count,
      IMPLEMENTING: count,
      VALIDATING: count,
      REVIEWING: count,
    }),
    repairs_total: count,
    tokens_charged: count,
    active_elapsed_ms: count,
  })
  .superRefine((ledger, context) => {
    const total = Object.values(ledger.repairs_by_stage).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (total !== ledger.repairs_total)
      context.addIssue({
        code: "custom",
        message: "Repair ledger total mismatch",
      });
  });

export const sessionStateSchema = z
  .strictObject({
    schema_version: schemaVersion,
    session_id: opaqueId,
    repository_id: opaqueId,
    base_commit: gitObject,
    mode: z.enum(["enforced", "advisory"]),
    state: stageSchema,
    state_sequence: count,
    current_candidate_id: digest.nullable(),
    input_digest: digest,
    limits: budgetLimitsSchema,
    budget: budgetLedgerSchema,
    blocking_reason: z.string().min(1).max(2048).nullable(),
  })
  .superRefine((session, context) => {
    if (
      session.budget.tokens_charged > session.limits.model_tokens ||
      session.budget.active_elapsed_ms > session.limits.active_session_ms ||
      session.budget.repairs_total > session.limits.repairs_total ||
      Object.values(session.budget.repairs_by_stage).some(
        (value) => value > session.limits.repairs_per_stage,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Ledger exceeds configured limits",
      });
    }
    if (
      [
        "VALIDATING",
        "REVIEWING",
        "APPROVED",
        "FINALIZING",
        "COMPLETED",
      ].includes(session.state) &&
      session.current_candidate_id === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Frozen stage requires candidate identity",
      });
    }
    if (
      session.mode === "advisory" &&
      ["APPROVED", "FINALIZING", "COMPLETED"].includes(session.state)
    ) {
      context.addIssue({
        code: "custom",
        message: "Advisory sessions cannot receive verified approval",
      });
    }
    if (
      ["BLOCKED", "CANCELLED"].includes(session.state) &&
      session.blocking_reason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Stopped session requires a reason",
      });
    }
  });

export type SessionState = z.infer<typeof sessionStateSchema>;
export type RepairStage = z.infer<typeof repairStageSchema>;
export type Stage = z.infer<typeof stageSchema>;
