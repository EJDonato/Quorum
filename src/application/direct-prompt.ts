import type { Outcome } from "../contracts/errors.js";

export interface DirectPromptRequest {
  runner: "agy" | "codex";
  executable: string;
  expectedVersion: string;
  model: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
}

export interface DirectPromptResponse {
  runner: "agy" | "codex";
  runnerVersion: string;
  model: string;
  text: string;
}

export interface DirectPromptProgress {
  phase: "checking" | "starting" | "working" | "tool" | "finishing";
  message: string;
}

export type DirectPromptProgressReporter = (
  progress: DirectPromptProgress,
) => void;

export type DirectPromptPort = (
  request: DirectPromptRequest,
  signal?: AbortSignal,
  onProgress?: DirectPromptProgressReporter,
) => Promise<Outcome<DirectPromptResponse>>;
