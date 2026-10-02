import { z } from "zod";
import {
  artifactReference,
  boundedText,
  digest,
  gitObject,
  opaqueId,
  repositoryPath,
  schemaVersion,
} from "./primitives.js";

export const testPreparationPolicySchema = z.strictObject({
  sessionId: opaqueId,
  changeKind: z.enum(["behavior", "contract", "refactor", "documentation"]),
  baselineTree: gitObject,
  implementationPaths: z.array(repositoryPath).min(1).max(256),
  protectedPaths: z.array(repositoryPath).max(256),
  testPaths: z.array(repositoryPath).min(1).max(256),
});
export type TestPreparationPolicy = z.infer<typeof testPreparationPolicySchema>;

const criterionMapping = z.discriminatedUnion("expectation", [
  z.strictObject({
    criterion_id: opaqueId,
    check_id: opaqueId,
    expectation: z.literal("behavioral"),
    expected_failure_id: opaqueId,
  }),
  z.strictObject({
    criterion_id: opaqueId,
    check_id: opaqueId,
    expectation: z.literal("compiler"),
    expected_failure_id: z.enum(["TS2322", "TS2345", "TS2416", "TS2741"]),
  }),
  z.strictObject({
    criterion_id: opaqueId,
    check_id: opaqueId,
    expectation: z.literal("regression"),
    justification: boundedText,
  }),
  z.strictObject({
    criterion_id: opaqueId,
    check_id: opaqueId,
    expectation: z.literal("documentation"),
    justification: boundedText,
  }),
]);

// QA supplies mappings, not session identity, execution evidence, or approval.
export const testSpecificationSchema = z.strictObject({
  schema_version: schemaVersion,
  motion_digest: digest,
  mappings: z.array(criterionMapping).min(1).max(256),
});

export const preparationIdentitySchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  phase: z.enum(["baseline", "expected_red"]),
  baseline_tree: gitObject,
  tree: gitObject,
  configuration_digest: digest,
  environment_digest: digest,
  motion_digest: digest,
  specification_digest: digest,
});
export const preparationSnapshotSchema = z.strictObject({
  schema_version: schemaVersion,
  input_digest: digest,
  identity: preparationIdentitySchema,
});

export const testPreparationReceiptSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  motion_digest: digest,
  specification_digest: digest,
  baseline_input_digest: digest,
  expected_red_input_digest: digest,
  checks: z
    .array(
      z.strictObject({
        phase: z.enum(["baseline", "expected_red"]),
        check_id: opaqueId,
        ref: artifactReference,
      }),
    )
    .min(1)
    .max(128),
});
export type TestSpecification = z.infer<typeof testSpecificationSchema>;
export type PreparationSnapshot = z.infer<typeof preparationSnapshotSchema>;
export type TestPreparationReceipt = z.infer<
  typeof testPreparationReceiptSchema
>;
