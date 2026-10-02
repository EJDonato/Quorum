import type { ConfigurationPort } from "../application/inspect-config.js";
import type { RunnerAdapter } from "../application/runner-ports.js";
import type {
  OrchestratorOptions,
  SessionRunResult,
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
  sessionRunner?: (
    options: OrchestratorOptions,
  ) => Promise<Outcome<SessionRunResult>>;
}

export interface ReplActionOutput {
  text: string;
  shouldExit?: boolean;
}
