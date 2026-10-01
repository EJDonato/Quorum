import {
  invocationRequestSchema,
  invocationResultSchema,
} from "../contracts/invocation.js";
import { reviewResultSchema, type ReviewResult } from "../contracts/reviews.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import { validateInvocationResult } from "../domain/invocations.js";
import { readEvidence, type EvidencePort } from "./evidence.js";

export async function readFinalReview(options: {
  ref: ArtifactReference;
  requestRef: ArtifactReference;
  invocationRef: ArtifactReference;
  port: EvidencePort;
}): Promise<Outcome<ReviewResult>> {
  const review = await readEvidence({
    ref: options.ref,
    schema: reviewResultSchema,
    port: options.port,
  });
  if (!review.ok) return review;
  const request = await readEvidence({
    ref: options.requestRef,
    schema: invocationRequestSchema,
    port: options.port,
  });
  if (!request.ok) return request;
  const result = await readEvidence({
    ref: options.invocationRef,
    schema: invocationResultSchema,
    port: options.port,
  });
  if (!result.ok) return result;
  const invocation = validateInvocationResult(request.value, result.value);
  if (!invocation.ok) return invocation;
  const expected = request.value.assignment;
  const actual = review.value.subject;
  if (
    expected.phase !== "final" ||
    actual.phase !== "final" ||
    expected.candidate_id !== actual.candidate_id ||
    expected.role !== actual.role ||
    review.value.invocation_id !== request.value.invocation_id ||
    review.value.session_id !== request.value.session_id ||
    review.value.input_digest !== request.value.input_digest ||
    result.value.output_ref?.artifact_id !== options.ref.artifact_id ||
    result.value.output_ref.digest !== options.ref.digest ||
    result.value.execution_status !== review.value.execution_status
  ) {
    return failure(
      "EVIDENCE_INVALID",
      "Final review is not bound to its host request, invocation, and output reference.",
    );
  }
  return review;
}
