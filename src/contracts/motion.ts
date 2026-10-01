import { z } from "zod";
import {
  boundedText,
  opaqueId,
  repositoryPath,
  schemaVersion,
} from "./primitives.js";

export const taskSchema = z.strictObject({
  task_id: opaqueId,
  dependencies: z.array(opaqueId).max(256),
  authorized_paths: z.array(repositoryPath).min(1).max(256),
  criterion_ids: z.array(opaqueId).min(1).max(256),
});

export const motionSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  risk: z.enum(["standard", "sensitive", "documentation", "refactor"]),
  fuzz_required: z.boolean(),
  tasks: z.array(taskSchema).min(1).max(256),
  acceptance_criteria: z
    .array(
      z.strictObject({
        criterion_id: opaqueId,
        description: boundedText,
        owner_task_id: opaqueId,
      }),
    )
    .min(1)
    .max(256),
});

export type Motion = z.infer<typeof motionSchema>;
