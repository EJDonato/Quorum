import type {
  CandidateIdentity,
  CandidateManifest,
} from "../contracts/candidate.js";
import type { BallotEvaluation } from "./finalize.js";
import { defaultBudgetLimits } from "../contracts/config.js";
import type { Outcome } from "../contracts/errors.js";
import type { CommitReceipt } from "../contracts/receipt.js";
import type { SessionState } from "../contracts/session.js";
import type { WorkspacePaths } from "../infrastructure/workspace/manager.js";

export interface SessionRunResult {
  sessionId: string;
  state: SessionState;
  candidateId?: string;
  receipt?: CommitReceipt;
}

export interface OrchestrationHooks {
  onPlan?: (workspace: WorkspacePaths) => Promise<Outcome<void>>;
  onTestAuthor?: (workspace: WorkspacePaths) => Promise<Outcome<void>>;
  onImplement?: (workspace: WorkspacePaths) => Promise<Outcome<void>>;
  onValidate?: (
    workspace: WorkspacePaths,
    candidateId: string,
  ) => Promise<Outcome<void>>;
  onReview?: (
    workspace: WorkspacePaths,
    candidateId: string,
  ) => Promise<Outcome<void>>;
}

export interface WorkflowVerification {
  preflight: () => Promise<Outcome<void>>;
  identity: Omit<
    CandidateIdentity,
    "schema_version" | "session_id" | "tree" | "base_commit"
  >;
  evidence: (
    candidate: CandidateManifest,
  ) => Promise<Outcome<Omit<BallotEvaluation, "session" | "candidate">>>;
}

export interface OrchestratorOptions {
  rootDir: string;
  sourceDir: string;
  sessionId: string;
  baseSha: string;
  objectFormat: "sha1" | "sha256";
  hooks: OrchestrationHooks;
  verification?: WorkflowVerification;
  commit?: boolean;
}

export interface WorkflowContext {
  options: OrchestratorOptions;
  workspace: WorkspacePaths;
  sessionDir: string;
  initial: SessionState;
  ports: { digest: (val: unknown) => Outcome<string> };
}

export function createInitialSessionState(options: {
  sessionId: string;
  baseSha: string;
  objectFormat: "sha1" | "sha256";
  repositoryId: string;
  inputDigest: string;
}): SessionState {
  return {
    schema_version: "1.0.0",
    session_id: options.sessionId,
    repository_id: options.repositoryId,
    base_commit: { format: options.objectFormat, oid: options.baseSha },
    mode: "enforced",
    state: "PREFLIGHT",
    state_sequence: 0,
    current_candidate_id: null,
    input_digest: options.inputDigest,
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
  };
}
