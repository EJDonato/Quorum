import { z } from "zod";
import { opaqueId } from "./primitives.js";

export const errorSchema = z.strictObject({
  code: z.enum([
    "INVALID_INPUT",
    "CAPABILITY_MISSING",
    "SCOPE_DENIED",
    "STALE_INPUT",
    "LOCKED",
    "BUDGET_EXHAUSTED",
    "CHECK_FAILED",
    "REVIEW_REJECTED",
    "EVIDENCE_INVALID",
    "SOURCE_DIVERGED",
    "STORAGE_FAILED",
    "CANCELLED",
  ]),
  message: z.string().min(1).max(2048),
  retryable: z.boolean(),
  remediation: z.string().min(1).max(2048),
  details_ref: opaqueId.optional(),
});

export type DomainError = z.infer<typeof errorSchema>;
export type Outcome<T> =
  { ok: true; value: T } | { ok: false; error: DomainError };

export function failure(
  code: DomainError["code"],
  message: string,
): { ok: false; error: DomainError } {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      remediation: "Correct the input or missing prerequisite before retrying.",
    },
  };
}
