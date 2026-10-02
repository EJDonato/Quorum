import type { Outcome } from "../contracts/errors.js";
import type {
  InvocationRequest,
  InvocationResult,
} from "../contracts/invocation.js";
import type { WorkspacePaths } from "../infrastructure/workspace/manager.js";

export interface RunnerCapabilities {
  runnerName: "agy" | "codex";
  runnerVersion: string;
  modelVersion: string;
  structuredOutput: boolean;
  brokerOnlyTools: boolean;
  descendantCancellation: boolean;
  usageReporting: boolean;
  enforceableTokenCeilings: boolean;
  isolationProfile: "linux-container-v1" | "none";
  enforcedConformance: boolean;
  evidenceDigest: string | null;
}

export interface CancellationReceipt {
  invocationId: string;
  descendantsTerminated: boolean;
  confirmedAbsent: boolean;
  timestamp: string;
  failureReason?: string;
}

export interface RunnerAdapter {
  discover(signal: AbortSignal): Promise<Outcome<RunnerCapabilities>>;
  invoke(
    request: InvocationRequest,
    signal: AbortSignal,
    workspace?: WorkspacePaths,
  ): Promise<Outcome<InvocationResult>>;
  cancel(invocationId: string): Promise<Outcome<CancellationReceipt>>;
}
