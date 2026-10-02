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

export type DirectPromptPort = (
  request: DirectPromptRequest,
  signal?: AbortSignal,
) => Promise<Outcome<DirectPromptResponse>>;
