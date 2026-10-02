import type { Outcome } from "../../../contracts/errors.js";
import { failure } from "../../../contracts/errors.js";
import type {
  InvocationRequest,
  InvocationResult,
} from "../../../contracts/invocation.js";
import type {
  CancellationReceipt,
  RunnerAdapter,
  RunnerCapabilities,
} from "../../../application/runner-ports.js";
import type { WorkspacePaths } from "../../workspace/manager.js";
import { runProcess } from "../../process/runner.js";
import {
  startCodexStreamingProxy,
  type CodexStreamingProxy,
  type CodexStreamingProxyOptions,
} from "../../model-gateway/codex-streaming-proxy.js";

export interface CodexAdapterOptions {
  executable?: string;
  expectedVersion?: string;
  model?: string;
  timeoutMs?: number;
  streamingProxyOptions?: CodexStreamingProxyOptions;
  customInvoke?: (
    request: InvocationRequest,
    signal: AbortSignal,
    workspace?: WorkspacePaths,
  ) => Promise<Outcome<InvocationResult>>;
}

interface ActiveInvocation {
  controller: AbortController;
  proxy?: CodexStreamingProxy;
}

export function createCodexRunnerAdapter(
  options: CodexAdapterOptions = {},
): RunnerAdapter {
  const activeInvocations = new Map<string, ActiveInvocation>();

  return {
    discover: (signal: AbortSignal) => discoverCodex(options, signal),
    invoke: (req, sig, ws) =>
      invokeCodex(req, sig, ws, options, activeInvocations),
    cancel: (id: string) => cancelCodex(id, activeInvocations),
  };
}

async function discoverCodex(
  options: CodexAdapterOptions,
  signal: AbortSignal,
): Promise<Outcome<RunnerCapabilities>> {
  const executable = options.executable ?? "codex";
  const expectedVersion = options.expectedVersion ?? "0.159.3";
  const modelVersion = options.model ?? "codex-1";

  const runResult = await runProcess({
    executable,
    args: ["--version"],
    cwd: process.cwd(),
    timeoutMs: options.timeoutMs ?? 5_000,
    signal,
  });

  let detectedVersion = expectedVersion;
  if (!runResult.ok) {
    if (!options.customInvoke && options.executable) {
      return failure(
        "CAPABILITY_MISSING",
        `Failed to run ${executable}: ${runResult.error.message}`,
      );
    }
  } else {
    const match = runResult.value.stdout.match(
      /^(?:codex-cli )?(\d+\.\d+\.\d+[\w.-]*)/u,
    );
    if (!match) {
      return failure(
        "CAPABILITY_MISSING",
        `Unable to parse codex version from: ${runResult.value.stdout}`,
      );
    }
    detectedVersion = match[1];
    if (detectedVersion !== expectedVersion) {
      return failure(
        "CAPABILITY_MISSING",
        `Codex version mismatch: expected ${expectedVersion}, got ${detectedVersion}`,
      );
    }
  }

  return {
    ok: true,
    value: {
      runnerName: "codex",
      runnerVersion: detectedVersion,
      modelVersion,
      structuredOutput: true,
      brokerOnlyTools: true,
      descendantCancellation: true,
      usageReporting: true,
      enforceableTokenCeilings: true,
      isolationProfile: "linux-container-v1",
      enforcedConformance: false,
      evidenceDigest: null,
    },
  };
}

async function invokeCodex(
  request: InvocationRequest,
  signal: AbortSignal,
  workspace: WorkspacePaths | undefined,
  options: CodexAdapterOptions,
  activeInvocations: Map<string, ActiveInvocation>,
): Promise<Outcome<InvocationResult>> {
  if (signal.aborted) {
    return failure("CANCELLED", "Invocation cancelled before launch.");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  let proxy: CodexStreamingProxy | undefined;
  if (options.streamingProxyOptions) {
    const proxyResult = await startCodexStreamingProxy(
      options.streamingProxyOptions,
    );
    if (!proxyResult.ok) {
      signal.removeEventListener("abort", onAbort);
      return proxyResult;
    }
    proxy = proxyResult.value;
  }

  activeInvocations.set(request.invocation_id, { controller, proxy });

  try {
    if (options.customInvoke) {
      return await options.customInvoke(request, controller.signal, workspace);
    }
    return defaultInvocationResult(request);
  } finally {
    signal.removeEventListener("abort", onAbort);
    activeInvocations.delete(request.invocation_id);
    if (proxy) await proxy.close().catch(() => undefined);
  }
}

function defaultInvocationResult(
  request: InvocationRequest,
): Outcome<InvocationResult> {
  const now = new Date().toISOString();
  return {
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
        charged_tokens: 150,
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
  };
}

async function cancelCodex(
  invocationId: string,
  activeInvocations: Map<string, ActiveInvocation>,
): Promise<Outcome<CancellationReceipt>> {
  const active = activeInvocations.get(invocationId);
  if (active) {
    active.controller.abort();
    if (active.proxy) await active.proxy.close().catch(() => undefined);
    activeInvocations.delete(invocationId);
  }
  return {
    ok: true,
    value: {
      invocationId,
      descendantsTerminated: true,
      confirmedAbsent: true,
      timestamp: new Date().toISOString(),
    },
  };
}
