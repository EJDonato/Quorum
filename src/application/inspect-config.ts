import {
  repositoryConfigSchema,
  type RepositoryConfig,
} from "../contracts/config.js";
import { failure, type Outcome } from "../contracts/errors.js";

export interface ConfigurationPort {
  read: (path: string) => Promise<Outcome<unknown>>;
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

export function capabilityDiagnostics(config: RepositoryConfig) {
  return {
    adapter: config.adapter.name,
    mode: config.mode,
    ready: false,
    capabilities: [
      { name: "configuration", status: "valid" },
      { name: "runner_conformance", status: "unverified" },
      { name: "broker_only_tools", status: "unimplemented" },
      { name: "container_isolation", status: "unverified" },
      { name: "usage_and_hard_token_ceiling", status: "unverified" },
      { name: "descendant_cancellation", status: "unverified" },
      { name: "validation_environment", status: "unverified" },
    ],
  };
}
