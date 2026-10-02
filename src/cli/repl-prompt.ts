import { inspectConfiguration } from "../application/inspect-config.js";
import { createDirectPromptRunner } from "../infrastructure/adapters/direct-prompt.js";
import { buildDirectAnswerPrompt } from "../prompts/direct.js";
import { sanitizeText } from "./repl-banner.js";
import { createReplProgressDisplay } from "./repl-progress.js";
import { recordReplTiming } from "./repl-performance.js";
import { directRunnerIdentity } from "./repl-runner-identity.js";
import {
  formatRunnerResponse,
  isInteractiveTerminal,
  supportsTerminalStyle,
  writeAnimatedTerminalText,
} from "./terminal-style.js";
import type { ReplActionOutput, ReplIo, ReplState } from "./repl-types.js";

export async function handlePromptSubmission(
  state: ReplState,
  io: ReplIo,
  prompt: string,
): Promise<ReplActionOutput> {
  const cleanPrompt = sanitizeText(prompt.trim());
  const config = await inspectConfiguration(state.configPath, {
    read: io.readConfig,
  });
  if (!config.ok)
    return { text: `Direct prompt blocked: ${config.error.message}` };
  const identity = directRunnerIdentity(state, config.value.adapter);
  const invoke = io.directPrompt ?? createDirectPromptRunner();
  const output = io.stdout ?? process.stdout;
  const progress = createReplProgressDisplay({
    output,
    runner: state.activeRunner,
  });
  const startedAt = Date.now();
  const conversationId = state.directSessions?.[state.activeRunner];
  const result = await invoke(
    {
      runner: state.activeRunner,
      executable: state.activeRunner,
      expectedVersion: identity.version,
      model: identity.model,
      prompt: buildDirectAnswerPrompt(cleanPrompt),
      cwd: state.rootDir,
      timeoutMs: Math.min(config.value.budgets.invocation_timeout_ms, 120_000),
      ...(conversationId ? { conversationId } : {}),
    },
    undefined,
    progress.report,
  ).finally(progress.stop);
  const durationMs = Date.now() - startedAt;
  recordReplTiming(state, { operation: "prompt", stage: "total", durationMs });
  if (!result.ok)
    return {
      text: sanitizeText(
        `Direct ${state.activeRunner} prompt failed [${result.error.code}]: ${result.error.message}`,
      ),
    };
  state.directSessions ??= {};
  state.directSessions[state.activeRunner] = result.value.conversationId;
  const response = formatRunnerResponse({
    runner: result.value.runner,
    model: result.value.model,
    text: result.value.text,
    color: supportsTerminalStyle(output),
    durationMs,
  });
  if (!isInteractiveTerminal(output)) return { text: response };
  await writeAnimatedTerminalText(output, `${response}\n`);
  return { text: "" };
}
