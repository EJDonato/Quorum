import { z } from "zod";
import {
  count,
  opaqueId,
  positiveCount,
  repositoryPath,
  schemaVersion,
} from "./primitives.js";

export const budgetLimitsSchema = z.strictObject({
  repairs_per_stage: count,
  repairs_total: count,
  invocation_timeout_ms: positiveCount,
  check_timeout_ms: positiveCount,
  active_session_ms: positiveCount,
  model_tokens: positiveCount,
});

const commandSchema = z.strictObject({
  check_id: opaqueId,
  kind: z.enum([
    "test",
    "lint",
    "typecheck",
    "documentation",
    "scanner",
    "fuzz",
  ]),
  report_format: z.literal("quorum-json-v1").optional(),
  fuzz: z
    .strictObject({ seed: count, cases_required: positiveCount.max(1_000_000) })
    .optional(),
  executable: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\u0000-\u001f\u007f]+$/),
  args: z
    .array(
      z
        .string()
        .max(4096)
        .regex(/^[^\u0000]+$/),
    )
    .max(128),
});

export const repositoryConfigSchema = z
  .strictObject({
    schema_version: schemaVersion,
    adapter: z.strictObject({
      name: z.enum(["agy", "codex"]),
      version: z.string().min(1).max(128),
      model: z.string().min(1).max(128),
    }),
    mode: z.enum(["enforced", "advisory"]),
    validation_image: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
    commands: z.array(commandSchema).min(1).max(64),
    permitted_environment_keys: z
      .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/))
      .max(64),
    paths: z.strictObject({
      implementation: z.array(repositoryPath).min(1).max(256),
      tests: z.array(repositoryPath).min(1).max(256),
      protected: z.array(repositoryPath).max(256),
      sensitive: z.array(repositoryPath).max(256),
    }),
    budgets: budgetLimitsSchema,
  })
  .superRefine((config, context) => {
    const ids = config.commands.map((command) => command.check_id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Check IDs must be unique",
        path: ["commands"],
      });
    }
  });

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>;

export const defaultBudgetLimits: BudgetLimits = {
  repairs_per_stage: 2,
  repairs_total: 6,
  invocation_timeout_ms: 600_000,
  check_timeout_ms: 600_000,
  active_session_ms: 3_600_000,
  model_tokens: 200_000,
};
