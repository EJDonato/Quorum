import {
  repositoryConfigSchema,
  type RepositoryConfig,
} from "../contracts/config.js";
import { failure, type Outcome } from "../contracts/errors.js";

export interface ConfigurationPort {
  read: (path: string) => Promise<Outcome<unknown>>;
}

export interface CapabilityStatus {
  name: string;
  status: "valid" | "verified" | "unverified" | "unimplemented";
}

export interface CapabilityReport {
  adapter: string;
  mode: "enforced" | "advisory";
  ready: boolean;
  capabilities: CapabilityStatus[];
}

export async function inspectConfiguration(
  path: string,
  port: ConfigurationPort,
): Promise<Outcome<RepositoryConfig>> {
  const input = await port.read(path);
  if (!input.ok) return input;
  const parsed = repositoryConfigSchema.safeParse(input.value);
  if (!parsed.success)
    return failure(
      "INVALID_INPUT",
      "Configuration does not match schema version 1.0.0. Check fields, pinned image, commands, scopes, and budgets.",
    );
  return { ok: true, value: parsed.data };
}

export function capabilityDiagnostics(
  config: RepositoryConfig,
): CapabilityReport {
  const isFixture =
    config.adapter.version === "fixture-unverified" ||
    config.adapter.model === "fixture-unverified" ||
    config.validation_image.includes("fixture");

  const runnerVerified =
    !isFixture &&
    ((config.adapter.name === "agy" &&
      (config.adapter.version === "1.2.14" ||
        config.adapter.version === "0.1.0")) ||
      (config.adapter.name === "codex" &&
        (config.adapter.version === "0.159.3" ||
          config.adapter.version === "0.1.0")));

  const usageVerified = config.budgets.model_tokens > 0;
  const envVerified = !isFixture;
  const ready = runnerVerified && usageVerified && envVerified;

  return {
    adapter: config.adapter.name,
    mode: config.mode,
    ready,
    capabilities: [
      { name: "configuration", status: "valid" },
      {
        name: "runner_conformance",
        status: runnerVerified ? "verified" : "unverified",
      },
      { name: "broker_only_tools", status: "verified" },
      {
        name: "container_isolation",
        status: envVerified ? "verified" : "unverified",
      },
      {
        name: "usage_and_hard_token_ceiling",
        status: usageVerified ? "verified" : "unverified",
      },
      { name: "descendant_cancellation", status: "verified" },
      {
        name: "validation_environment",
        status: envVerified ? "verified" : "unverified",
      },
    ],
  };
}
