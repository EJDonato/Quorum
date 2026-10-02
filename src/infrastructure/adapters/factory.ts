import type { RunnerAdapter } from "../../application/runner-ports.js";
import {
  createAgyRunnerAdapter,
  type AgyAdapterOptions,
} from "./agy/adapter.js";
import {
  createCodexRunnerAdapter,
  type CodexAdapterOptions,
} from "./codex/adapter.js";

export interface CreateRunnerAdapterOptions {
  agy?: AgyAdapterOptions;
  codex?: CodexAdapterOptions;
}

export function createRunnerAdapter(
  runnerName: "agy" | "codex",
  options?: CreateRunnerAdapterOptions,
): RunnerAdapter {
  if (runnerName === "agy") {
    return createAgyRunnerAdapter(options?.agy);
  }
  return createCodexRunnerAdapter(options?.codex);
}
