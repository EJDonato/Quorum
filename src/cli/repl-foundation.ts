import {
  createFoundationPlan,
  type FoundationDraftPort,
} from "../application/foundation-plan.js";
import { inspectConfiguration } from "../application/inspect-config.js";
import { createDirectPromptRunner } from "../infrastructure/adapters/direct-prompt.js";
import {
  createFoundationPublisher,
  displayFoundationPath,
} from "../infrastructure/foundation/publisher.js";
import type { FoundationStage } from "../prompts/foundation.js";
import { sanitizeText } from "./repl-banner.js";
import { createReplProgressDisplay } from "./repl-progress.js";
import { directRunnerIdentity } from "./repl-runner-identity.js";
import type { ReplActionOutput, ReplIo, ReplState } from "./repl-types.js";

const stageLabels: Readonly<Record<FoundationStage, string>> = {
  product: "Drafting product requirements",
  architecture: "Designing system architecture",
  delivery: "Planning implementation delivery",
};

export async function handleFoundationCommand(
  state: ReplState,
  io: ReplIo,
  requirements: string,
): Promise<ReplActionOutput> {
  const cleanRequirements = sanitizeText(requirements.trim());
  if (!cleanRequirements)
    return {
      text: "Foundation drafting requires project requirements. Use /foundation <requirements>.",
    };
  const config = await inspectConfiguration(state.configPath, {
    read: io.readConfig,
  });
  if (!config.ok)
    return { text: `Foundation drafting blocked: ${config.error.message}` };

  const draft = createDraftPort({
    state,
    io,
    adapter: config.value.adapter,
    configuredTimeoutMs: config.value.budgets.invocation_timeout_ms,
  });
  const publication =
    io.foundationPublication ?? createFoundationPublisher(state.rootDir);
  const result = await createFoundationPlan({
    requirements: cleanRequirements,
    draft,
    publication,
  });
  if (!result.ok)
    return {
      text: sanitizeText(
        `Foundation drafting failed [${result.error.code}]: ${result.error.message}`,
      ),
    };
  return {
    text: [
      "Foundation documents created as drafts:",
      ...result.value.paths.map(
        (path) => `  ${displayFoundationPath(state.rootDir, path)}`,
      ),
      "",
      "Review these documents, then use /run <task> to begin implementation. Drafts are not Quorum approval evidence.",
    ].join("\n"),
  };
}

function createDraftPort(options: {
  state: ReplState;
  io: ReplIo;
  adapter: { name: string; version: string; model: string };
  configuredTimeoutMs: number;
}): FoundationDraftPort {
  const { state, io, adapter, configuredTimeoutMs } = options;
  const identity = directRunnerIdentity(state, adapter);
  const invoke = io.directPrompt ?? createDirectPromptRunner();
  const output = io.stdout ?? process.stdout;
  return async (stage, prompt) => {
    const progress = createReplProgressDisplay({
      output,
      runner: state.activeRunner,
    });
    progress.report({ phase: "starting", message: stageLabels[stage] });
    const result = await invoke(
      {
        runner: state.activeRunner,
        executable: state.activeRunner,
        expectedVersion: identity.version,
        model: identity.model,
        prompt,
        cwd: state.rootDir,
        timeoutMs: Math.min(configuredTimeoutMs, 120_000),
      },
      undefined,
      progress.report,
    ).finally(progress.stop);
    if (!result.ok) return result;
    return { ok: true, value: result.value.text };
  };
}
