import {
  repositoryConfigSchema,
  type RepositoryConfig,
} from "../contracts/config.js";
import type { CandidateManifest } from "../contracts/candidate.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { verifyCandidateIdentity } from "./candidates.js";
import type { RunCheckOptions } from "./validation-ports.js";
export function validationEnvironment(
  config: Pick<RepositoryConfig, "validation_image">,
  environment: Record<string, string>,
) {
  return {
    profile: "linux-validation-v1",
    image: config.validation_image,
    environment: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      TMPDIR: "/tmp",
      ...environment,
    },
    cpu: 1,
    memory_bytes: 536_870_912,
    pids: 64,
    scratch_bytes: 67_108_864,
    network: "none",
    user: "65534:65534",
    read_only: true,
  };
}

export function prepareValidation(options: RunCheckOptions): Outcome<{
  config: RepositoryConfig;
  candidate: CandidateManifest;
  command: RepositoryConfig["commands"][number];
  configDigest: string;
  commandDigest: string;
  envDigest: string;
}> {
  const config = repositoryConfigSchema.safeParse(options.config);
  const candidate = verifyCandidateIdentity(options.candidate, options.ports);
  if (!config.success)
    return failure("INVALID_INPUT", "Invalid frozen validation configuration.");
  if (!candidate.ok) return candidate;
  if (config.data.mode !== "enforced")
    return failure(
      "CAPABILITY_MISSING",
      "Advisory mode cannot execute enforced checks.",
    );
  const selected = selectCommand(config.data, options.checkId);
  if (!selected.ok) return selected;
  const command = selected.value;
  const environment = validateEnvironment(config.data, options.environment);
  if (!environment.ok) return environment;
  const configDigest = options.ports.digest(config.data);
  const commandDigest = options.ports.digest(command);
  const envDigest = options.ports.digest(
    validationEnvironment(config.data, options.environment),
  );
  if (!configDigest.ok) return configDigest;
  if (!commandDigest.ok) return commandDigest;
  if (!envDigest.ok) return envDigest;
  if (
    candidate.value.identity.configuration_digest !== configDigest.value ||
    candidate.value.identity.validation_environment_digest !== envDigest.value
  )
    return failure(
      "STALE_INPUT",
      "Validation inputs differ from the frozen candidate.",
    );
  return {
    ok: true,
    value: {
      config: config.data,
      candidate: candidate.value,
      command,
      configDigest: configDigest.value,
      commandDigest: commandDigest.value,
      envDigest: envDigest.value,
    },
  };
}

function validateEnvironment(
  config: RepositoryConfig,
  environment: Record<string, string>,
): Outcome<void> {
  for (const key of Object.keys(environment)) {
    if (
      !config.permitted_environment_keys.includes(key) ||
      /SECRET|TOKEN|PASSWORD|CREDENTIAL|KEY|COOKIE|AUTH|PATH|HOME|OPTIONS|PRELOAD|LIBRARY/i.test(
        key,
      )
    )
      return failure(
        "SCOPE_DENIED",
        "Environment key is not permitted for validation.",
      );
    if (/[\r\n\0]/.test(environment[key] ?? ""))
      return failure("INVALID_INPUT", "Invalid environment value.");
  }
  return { ok: true, value: undefined };
}

function selectCommand(
  config: RepositoryConfig,
  checkId: string,
): Outcome<RepositoryConfig["commands"][number]> {
  const command = config.commands.find((value) => value.check_id === checkId);
  if (!command) return failure("SCOPE_DENIED", "Check is not configured.");
  if (!command.report_format)
    return failure(
      "CAPABILITY_MISSING",
      "Check requires a configured structured report wrapper.",
    );
  if (command.kind === "fuzz" && !command.fuzz)
    return failure(
      "CAPABILITY_MISSING",
      "Fuzz checks require frozen seed and case limits.",
    );
  return { ok: true, value: command };
}
