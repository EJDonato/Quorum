import { defaultBudgetLimits } from "../../src/contracts/config.js";
import {
  sessionStateSchema,
  type SessionState,
} from "../../src/contracts/session.js";

export const inputDigest = `sha256:${"a".repeat(64)}`;
export const candidateId = `sha256:${"b".repeat(64)}`;

export function initialSession(): SessionState {
  return sessionStateSchema.parse({
    schema_version: "1.0.0",
    session_id: "session-fixture",
    repository_id: "repo-fixture",
    base_commit: { format: "sha1", oid: "c".repeat(40) },
    mode: "enforced",
    state: "PREFLIGHT",
    state_sequence: 0,
    current_candidate_id: null,
    input_digest: inputDigest,
    limits: { ...defaultBudgetLimits },
    budget: {
      repairs_by_stage: {
        PLANNING: 0,
        DESIGN_REVIEW: 0,
        TEST_SPEC: 0,
        IMPLEMENTING: 0,
        VALIDATING: 0,
        REVIEWING: 0,
      },
      repairs_total: 0,
      tokens_charged: 0,
      active_elapsed_ms: 0,
    },
    blocking_reason: null,
  });
}
