import { z } from "zod";
import {
  digest,
  gitObject,
  opaqueId,
  schemaVersion,
  versionLabel,
} from "./primitives.js";

export const candidateIdentitySchema = z
  .strictObject({
    schema_version: schemaVersion,
    session_id: opaqueId,
    base_commit: gitObject,
    tree: gitObject,
    policy_hash: digest,
    configuration_digest: digest,
    plan_digest: digest,
    acceptance_digest: digest,
    contract_digest: digest,
    tests_digest: digest,
    validation_environment_digest: digest,
    adapter: z.strictObject({
      name: z.enum(["agy", "codex"]),
      version: versionLabel,
      model: versionLabel,
      model_version: versionLabel,
    }),
    persona_digest: digest,
  })
  .superRefine((identity, context) => {
    if (identity.base_commit.format !== identity.tree.format) {
      context.addIssue({
        code: "custom",
        message: "Base and tree Git formats must match",
      });
    }
  });

export const candidateManifestSchema = z.strictObject({
  schema_version: schemaVersion,
  candidate_id: digest,
  identity: candidateIdentitySchema,
});

export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>;
export type CandidateManifest = z.infer<typeof candidateManifestSchema>;
