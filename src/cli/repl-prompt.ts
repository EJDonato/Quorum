import { inspectConfiguration } from "../application/inspect-config.js";
import { createDirectPromptRunner } from "../infrastructure/adapters/direct-prompt.js";
import { sanitizeText } from "./repl-banner.js";
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
  const result = await invoke(
    {
      runner: state.activeRunner,
      executable: state.activeRunner,
      expectedVersion: identity.version,
      model: identity.model,
      prompt: cleanPrompt,
      cwd: state.rootDir,
      timeoutMs: Math.min(config.value.budgets.invocation_timeout_ms, 120_000),
    },
    undefined,
    (progress) => {
      const output = io.stdout ?? process.stdout;
      output.write(
        `[${state.activeRunner}] ${sanitizeText(progress.message)}\n`,
      );
    },
  );
  if (!result.ok)
    return {
      text: sanitizeText(
        `Direct ${state.activeRunner} prompt failed [${result.error.code}]: ${result.error.message}`,
      ),
    };
  return {
    text: [
      `${result.value.runner} response (${result.value.model}, read-only direct mode):`,
      sanitizeText(result.value.text),
      "",
      "This response is not Quorum approval evidence. Use /run <task> for the council workflow.",
    ].join("\n"),
  };
}

function directRunnerIdentity(
  state: ReplState,
  configured: { name: string; version: string; model: string },
) {
  const defaults =
    state.activeRunner === "agy"
      ? { version: "1.2.14", model: "gemini-3.8-flash-medium" }
      : { version: "0.159.3", model: "gpt-6-sol" };
  if (configured.name !== state.activeRunner) return defaults;
  const placeholder =
    configured.model === "codex-1" || configured.model === "gemini-2.5-pro";
  return {
    version: configured.version,
    model: placeholder ? defaults.model : configured.model,
  };
}
