import { createHash, randomUUID } from "node:crypto";
import { inspectConfiguration } from "../application/inspect-config.js";
import { runSession } from "../application/orchestrator.js";
import { createRunnerOrchestrationHooks } from "../application/runner-dispatch.js";
import { createRunnerAdapter } from "../infrastructure/adapters/factory.js";
import { readSourceRepositoryInfo } from "../infrastructure/git/operations.js";
import { sanitizeText } from "./repl-banner.js";
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

  const sessionId = "sess" + randomUUID().replace(/-/g, "").slice(0, 24);
  state.activeSessionId = sessionId;
  const adapter =
    io.runnerAdapterFactory?.(state.activeRunner) ??
    createRunnerAdapter(state.activeRunner);

  const inputDigest = `sha256:${createHash("sha256").update(cleanPrompt).digest("hex")}`;
  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest,
    responseSchemaRef: { artifact_id: "schema-ref", digest: inputDigest },
    timeoutMs: config.value.budgets.active_session_ms,
    tokensReserved: config.value.budgets.model_tokens,
  });

  const runner = io.sessionRunner ?? runSession;
  const result = await runner({
    rootDir: state.rootDir,
    sourceDir: state.rootDir,
    sessionId,
    baseSha: repo.value.headSha,
    objectFormat: repo.value.objectFormat,
    hooks,
    commit: true,
  });

  if (!result.ok) {
    return {
      text: `Session ${sessionId} halted:\n  [${result.error.code}] ${result.error.message}`,
    };
  }
  const out = [
    `Session ${sessionId} completed!\n  State: ${result.value.state.state}`,
  ];
  if (result.value.receipt) {
    out.push(`  Commit OID: ${result.value.receipt.commit_oid}`);
  }
  return { text: out.join("\n") };
}
