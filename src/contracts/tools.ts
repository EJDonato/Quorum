import { z } from "zod";
import { digest, opaqueId } from "./primitives.js";

export const repoReadInputSchema = z.strictObject({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024)
    .optional(),
});

export const repoReadOutputSchema = z.strictObject({
  content: z.string(),
  digest: digest,
  truncated: z.boolean(),
});

export const repoSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(256),
  paths: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const searchMatchSchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().positive(),
  text: z.string().max(2048),
});

export const repoSearchOutputSchema = z.strictObject({
  matches: z.array(searchMatchSchema),
  truncated: z.boolean(),
});

export const artifactReadInputSchema = z.strictObject({
  artifact_id: opaqueId,
});

export const artifactReadOutputSchema = z.strictObject({
  payload: z.unknown(),
  digest: digest,
});

export const draftApplyPatchInputSchema = z.strictObject({
  expected_draft_digest: digest,
  patch: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
});

export const draftApplyPatchOutputSchema = z.strictObject({
  draft_digest: digest,
  changed_paths: z.array(z.string().min(1)),
});

export const checksRunInputSchema = z.strictObject({
  check_id: opaqueId,
  input_digest: digest,
});

export const checksRunOutputSchema = z.strictObject({
  execution_id: opaqueId,
  status: z.enum(["PASSED", "FAILED", "BLOCKED"]),
  evidence_ref: opaqueId,
});

export const roleSubmitInputSchema = z.strictObject({
  body: z.record(z.string(), z.unknown()),
});

export const roleSubmitOutputSchema = z.strictObject({
  result_ref: opaqueId,
});

export const scopeRequestInputSchema = z.strictObject({
  paths: z.array(z.string().min(1)),
  reason: z.string().min(1).max(2048),
});

export const scopeRequestOutputSchema = z.strictObject({
  request_ref: opaqueId,
  status: z.literal("SUBMITTED"),
});

export type RepoReadInput = z.infer<typeof repoReadInputSchema>;
export type RepoReadOutput = z.infer<typeof repoReadOutputSchema>;
export type SearchMatch = z.infer<typeof searchMatchSchema>;
export type RepoSearchInput = z.infer<typeof repoSearchInputSchema>;
export type RepoSearchOutput = z.infer<typeof repoSearchOutputSchema>;
export type ArtifactReadInput = z.infer<typeof artifactReadInputSchema>;
export type ArtifactReadOutput = z.infer<typeof artifactReadOutputSchema>;
export type DraftApplyPatchInput = z.infer<typeof draftApplyPatchInputSchema>;
export type DraftApplyPatchOutput = z.infer<typeof draftApplyPatchOutputSchema>;
export type ChecksRunInput = z.infer<typeof checksRunInputSchema>;
export type ChecksRunOutput = z.infer<typeof checksRunOutputSchema>;
export type RoleSubmitInput = z.infer<typeof roleSubmitInputSchema>;
export type RoleSubmitOutput = z.infer<typeof roleSubmitOutputSchema>;
export type ScopeRequestInput = z.infer<typeof scopeRequestInputSchema>;
export type ScopeRequestOutput = z.infer<typeof scopeRequestOutputSchema>;
