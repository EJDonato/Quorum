import type {
  CancellationReceipt,
  RunnerAdapter,
  RunnerCapabilities,
} from "../../src/application/runner-ports.js";
import type { Outcome } from "../../src/contracts/errors.js";
import type {
  InvocationRequest,
  InvocationResult,
} from "../../src/contracts/invocation.js";

export function createFakeRunnerAdapter(options?: {
  shouldFail?: boolean;
  failureMessage?: string;
  tokensCharged?: number;
}): RunnerAdapter {
  return {
    discover: (): Promise<Outcome<RunnerCapabilities>> =>
      Promise.resolve({
        ok: true,
        value: {
          runnerName: "agy",
          runnerVersion: "1.2.14-fake",
          modelVersion: "gemini-3.8-flash-fake",
          structuredOutput: true,
          brokerOnlyTools: true,
          descendantCancellation: true,
          usageReporting: true,
          enforceableTokenCeilings: true,
          isolationProfile: "linux-container-v1",
          enforcedConformance: false,
          evidenceDigest: null,
        },
      }),
    invoke: (
      request: InvocationRequest,
    ): Promise<Outcome<InvocationResult>> => {
      const now = new Date().toISOString();
      if (options?.shouldFail) {
        return Promise.resolve({
          ok: true,
          value: {
            protocol_version: "1.0.0",
            invocation_id: request.invocation_id,
            session_id: request.session_id,
            input_digest: request.input_digest,
            execution_status: "FAILED",
            usage: null,
            output_ref: null,
            error: {
              code: "CHECK_FAILED",
              message: options.failureMessage ?? "Injected fake runner error",
              retryable: false,
              remediation: "Inspect prompt or tool gate",
            },
            started_at: now,
            ended_at: now,
          },
        });
      }
      const charged = options?.tokensCharged ?? 150;
      return Promise.resolve({
        ok: true,
        value: {
          protocol_version: "1.0.0",
          invocation_id: request.invocation_id,
          session_id: request.session_id,
          input_digest: request.input_digest,
          execution_status: "SUCCEEDED",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
            charged_tokens: charged,
            accounting_complete: true,
          },
          output_ref: {
            artifact_id: `output-${request.assignment.role}`,
            digest: request.input_digest,
          },
          error: null,
          started_at: now,
          ended_at: now,
        },
      });
    },
    cancel: (invocationId: string): Promise<Outcome<CancellationReceipt>> =>
      Promise.resolve({
        ok: true,
        value: {
          invocationId,
          descendantsTerminated: true,
          confirmedAbsent: true,
          timestamp: new Date().toISOString(),
        },
      }),
  };
}
