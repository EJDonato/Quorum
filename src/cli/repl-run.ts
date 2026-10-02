import { createHash, randomUUID } from "node:crypto";
import { inspectConfiguration } from "../application/inspect-config.js";
import { runSession } from "../application/orchestrator.js";
import { createRunnerOrchestrationHooks } from "../application/runner-dispatch.js";
import { createRunnerAdapter } from "../infrastructure/adapters/factory.js";
import { readSourceRepositoryInfo } from "../infrastructure/git/operations.js";
import { createWorkflowVerification } from "../application/workflow-verification.js";
import type { WorkflowVerification } from "../application/session-init.js";
import type { RepositoryConfig } from "../contracts/config.js";
import { sanitizeText } from "./repl-banner.js";
import { recordReplTiming, formatDuration } from "./repl-performance.js";
import {
  createReplProgressDisplay,
  type ReplProgressDisplay,
} from "./repl-progress.js";
import type { ReplActionOutput, ReplIo, ReplState } from "./repl-types.js";

export async function handleRunCommand(
  state: ReplState,
  io: ReplIo,
  prompt?: string,
): Promise<ReplActionOutput> {
  const cleanPrompt = prompt ? sanitizeText(prompt.trim()) : "";
  if (!cleanPrompt) {
    return { text: "Missing prompt for /run. Usage: /run <task description>" };
  }
  const config = await inspectConfiguration(state.configPath, {
    read: io.readConfig,
  });
  if (!config.ok) {
    return {
      text: `Config invalid (${state.configPath}): ${config.error.message}`,
    };
  }
  const repo = await readSourceRepositoryInfo(state.rootDir);
  if (!repo.ok) {
    return { text: `Repository error: ${repo.error.message}` };
  }

  return runConfiguredSession({
    state,
    io,
    config: config.value,
    baseSha: repo.value.headSha,
    objectFormat: repo.value.objectFormat,
    cleanPrompt,
  });
}

async function runConfiguredSession(options: {
  state: ReplState;
  io: ReplIo;
  config: RepositoryConfig;
  baseSha: string;
  objectFormat: "sha1" | "sha256";
  cleanPrompt: string;
}): Promise<ReplActionOutput> {
  const { state, io, config, baseSha, objectFormat, cleanPrompt } = options;
  const { sessionId, inputDigest } = prepareRunInput(state, cleanPrompt);
  const adapter =
    io.runnerAdapterFactory?.(state.activeRunner) ??
    createRunnerAdapter(state.activeRunner);
  const output = io.stdout ?? process.stdout;
  const progress = createReplProgressDisplay({
    output,
    runner: state.activeRunner,
  });
  const startedAt = Date.now();

  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest,
    responseSchemaRef: { artifact_id: "schema-ref", digest: inputDigest },
    timeoutMs: config.budgets.invocation_timeout_ms,
    tokensReserved: config.budgets.model_tokens,
    onStage: createRunStageReporter(state, progress),
  });

  const verification =
    io.verificationFactory?.(sessionId, inputDigest) ??
    createWorkflowVerification({
      rootDir: state.rootDir,
      config,
      sessionId,
      inputDigest,
    });

  const result = await executeRunSession(io, {
    state,
    sessionId,
    baseSha,
    objectFormat,
    hooks,
    verification,
  }).finally(progress.stop);
  const durationMs = Date.now() - startedAt;
  recordReplTiming(state, { operation: "run", stage: "total", durationMs });

  return formatRunResult(sessionId, result, durationMs);
}

function createRunStageReporter(
  state: ReplState,
  progress: ReplProgressDisplay,
) {
  return (event: {
    stage: string;
    status: "started" | "completed" | "failed";
    durationMs: number;
  }) => {
    progress.report({
      phase: event.status === "started" ? "starting" : "finishing",
      message:
        event.status === "started"
          ? `Starting ${event.stage}.`
          : `${event.stage} ${event.status} in ${formatDuration(event.durationMs)}.`,
    });
    if (event.status !== "started")
      recordReplTiming(state, {
        operation: "run",
        stage: event.stage,
        durationMs: event.durationMs,
      });
  };
}

async function executeRunSession(
  io: ReplIo,
  opts: {
    state: ReplState;
    baseSha: string;
    objectFormat: "sha1" | "sha256";
    sessionId: string;
    hooks: Parameters<typeof runSession>[0]["hooks"];
    verification: WorkflowVerification;
  },
) {
  const runner = io.sessionRunner ?? runSession;
  return runner({
    rootDir: opts.state.rootDir,
    sourceDir: opts.state.rootDir,
    sessionId: opts.sessionId,
    baseSha: opts.baseSha,
    objectFormat: opts.objectFormat,
    hooks: opts.hooks,
    verification: opts.verification,
    commit: true,
  });
}

function prepareRunInput(state: ReplState, cleanPrompt: string) {
  const sessionId = "sess" + randomUUID().replace(/-/g, "").slice(0, 24);
  const inputDigest = `sha256:${createHash("sha256").update(cleanPrompt).digest("hex")}`;
  state.activeSessionId = sessionId;
  return { sessionId, inputDigest };
}

function formatRunResult(
  sessionId: string,
  result: Awaited<ReturnType<typeof runSession>>,
  durationMs: number,
): ReplActionOutput {
  if (!result.ok) {
    return {
      text: `Session ${sessionId} halted after ${formatDuration(durationMs)}:\n  [${result.error.code}] ${result.error.message}`,
    };
  }
  const out = [
    `Session ${sessionId} completed in ${formatDuration(durationMs)}!\n  State: ${result.value.state.state}`,
  ];
  if (result.value.receipt) {
    out.push(`  Commit OID: ${result.value.receipt.commit.oid}`);
  }
  return { text: out.join("\n") };
}
