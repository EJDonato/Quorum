import type { RepositoryConfig } from "../contracts/config.js";
import type { CheckResult } from "../contracts/checks.js";
import type { ValidationIntent } from "../contracts/validation.js";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import type { Outcome } from "../contracts/errors.js";
import type { CheckTarget } from "./check-target.js";
export interface SandboxResult {
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cleanupConfirmed: boolean;
}
export interface ValidationPorts {
  digest: (value: unknown) => Outcome<string>;
  authorize: () => Promise<Outcome<{ remainingMs: number }>>;
  persistIntent: (intent: ValidationIntent) => Promise<Outcome<void>>;
  execute: (request: {
    intent: ValidationIntent;
    command: RepositoryConfig["commands"][number];
    environment: Record<string, string>;
    deadlineMs: number;
  }) => Promise<Outcome<SandboxResult>>;
  persistStreams: (
    id: string,
    streams: { stdout: string; stderr: string },
  ) => Promise<
    Outcome<{ stdout: ArtifactReference; stderr: ArtifactReference }>
  >;
  persistResult: (record: CheckResult) => Promise<Outcome<ArtifactReference>>;
  now: () => Date;
}
export type RunCheckOptions = CheckTarget & {
  config: unknown;
  checkId: string;
  invocationId: string;
  environment: Record<string, string>;
  ports: ValidationPorts;
};
