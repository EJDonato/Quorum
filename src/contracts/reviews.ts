import { z } from "zod";
import {
  artifactReference,
  boundedText,
  digest,
  executionStatus,
  opaqueId,
  repositoryPath,
  schemaVersion,
  utcTimestamp,
} from "./primitives.js";

const findingSchema = z.strictObject({
  criterion_id: opaqueId.nullable(),
  severity: z.enum(["blocking", "warning", "info"]),
  path: repositoryPath.nullable(),
  message: boundedText,
  evidence_refs: z.array(artifactReference).min(1).max(64),
});

// The model body has no host identity, role, phase, candidate, or output path.
export const reviewBodySchema = z.discriminatedUnion("verdict", [
  z.strictObject({
    verdict: z.literal("APPROVED"),
    findings: z.array(findingSchema).max(256),
    evidence_refs: z.array(artifactReference).min(1).max(256),
  }),
  z.strictObject({
    verdict: z.literal("REJECTED"),
    findings: z.array(findingSchema).min(1).max(256),
    evidence_refs: z.array(artifactReference).min(1).max(256),
  }),
  z.strictObject({
    verdict: z.literal("INCOMPLETE"),
    reason: boundedText,
    findings: z.array(findingSchema).max(256),
    evidence_refs: z.array(artifactReference).max(256),
  }),
]);

export const reviewResultSchema = z
  .strictObject({
    schema_version: schemaVersion,
    session_id: opaqueId,
    invocation_id: opaqueId,
    input_digest: digest,
    subject: z.discriminatedUnion("phase", [
      z.strictObject({
        phase: z.literal("design"),
        role: z.literal("security"),
        contract_input_digest: digest,
      }),
      z.strictObject({
        phase: z.literal("final"),
        role: z.enum(["qa", "security"]),
        candidate_id: digest,
      }),
    ]),
    execution_status: executionStatus,
    submitted_at: utcTimestamp,
    body: reviewBodySchema,
  })
  .superRefine((result, context) => {
    if (
      result.body.verdict === "APPROVED" &&
      result.body.findings.some((finding) => finding.severity === "blocking")
    ) {
      context.addIssue({
        code: "custom",
        message: "Blocking findings cannot approve",
      });
    }
    if (
      result.execution_status !== "SUCCEEDED" &&
      result.body.verdict !== "INCOMPLETE"
    ) {
      context.addIssue({
        code: "custom",
        message: "Interrupted execution cannot submit a final verdict",
      });
    }
  });

export type ReviewResult = z.infer<typeof reviewResultSchema>;
