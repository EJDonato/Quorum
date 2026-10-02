import type { ConfigurationPort } from "../application/inspect-config.js";

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
}

export interface ReplActionOutput {
  text: string;
  shouldExit?: boolean;
}
