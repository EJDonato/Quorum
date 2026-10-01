import { z } from "zod";
import {
  artifactReference,
  digest,
  opaqueId,
  schemaVersion,
} from "./primitives.js";

export const ballotRequirementsSchema = z
  .strictObject({
    schema_version: schemaVersion,
    policy_hash: digest,
    criterion_ids: z.array(opaqueId).min(1).max(256),
    required_checks: z
      .array(
        z.strictObject({
          check_id: opaqueId,
          kind: z.enum([
            "test",
            "lint",
            "typecheck",
            "documentation",
            "scanner",
            "fuzz",
          ]),
          command_digest: digest,
        }),
      )
      .min(1)
      .max(64),
  })
  .superRefine((requirements, context) => {
    const ids = requirements.required_checks.map((check) => check.check_id);
    if (
      new Set(ids).size !== ids.length ||
      new Set(requirements.criterion_ids).size !==
        requirements.criterion_ids.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Required check and criterion IDs must be unique",
      });
    }
  });

export const ballotEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("check"), ref: artifactReference }),
  z.strictObject({
    kind: z.literal("review"),
    ref: artifactReference,
    request_ref: artifactReference,
    invocation_ref: artifactReference,
  }),
]);

export const ballotEvidenceReferencesSchema = z
  .array(ballotEvidenceReferenceSchema)
  .min(1)
  .max(512);
export type BallotRequirements = z.infer<typeof ballotRequirementsSchema>;
export type ArtifactReference = z.infer<typeof artifactReference>;
