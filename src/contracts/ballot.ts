import { z } from "zod";
import {
  artifactReference,
  digest,
  opaqueId,
  schemaVersion,
} from "./primitives.js";

export const ballotReasonSchema = z.enum([
  "ADVISORY_MODE",
  "PREREQUISITES_INCOMPLETE",
  "CHECK_MISSING",
  "CHECK_FAILED",
  "QA_MISSING",
  "SECURITY_MISSING",
  "REVIEW_REJECTED",
  "REVIEW_INCOMPLETE",
  "EVIDENCE_INVALID",
]);

export const ballotSchema = z
  .strictObject({
    schema_version: schemaVersion,
    session_id: opaqueId,
    candidate_id: digest,
    policy_hash: digest,
    evidence: z.array(artifactReference).max(512),
    reason_codes: z.array(ballotReasonSchema).max(16),
    quorum_achieved: z.boolean(),
  })
  .superRefine((ballot, context) => {
    if (ballot.quorum_achieved !== (ballot.reason_codes.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Ballot outcome contradicts reasons",
      });
    }
  });

export type Ballot = z.infer<typeof ballotSchema>;
export type BallotReason = z.infer<typeof ballotReasonSchema>;
