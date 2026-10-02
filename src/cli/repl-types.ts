import type { ConfigurationPort } from "../application/inspect-config.js";
import type { DirectPromptPort } from "../application/direct-prompt.js";
import type { RunnerAdapter } from "../application/runner-ports.js";
import type {
  OrchestratorOptions,
  SessionRunResult,
  WorkflowVerification,
} from "../application/session-init.js";
import type { Outcome } from "../contracts/errors.js";

export type RunnerName = "agy" | "codex";

export interface ReplState {
  configPath: string;
  activeRunner: RunnerName;
  rootDir: string;
  activeSessionId: string | null;
  exitRequested: boolean;
}

export interface ReplIo {
  readConfig: ConfigurationPort["read"];
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  runnerAdapterFactory?: (runner: RunnerName) => RunnerAdapter;
  directPrompt?: DirectPromptPort;
  sessionRunner?: (
    options: OrchestratorOptions,
  ) => Promise<Outcome<SessionRunResult>>;
  verificationFactory?: (
    sessionId: string,
    inputDigest: string,
  ) => WorkflowVerification;
}

export interface ReplActionOutput {
  text: string;
  shouldExit?: boolean;
}
