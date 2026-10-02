import assert from "node:assert/strict";
import { readFile, mkdir, readdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryConfig } from "../../src/contracts/config.js";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { createCandidateIdentity } from "../../src/application/candidates.js";
import { validationEnvironment } from "../../src/application/run-check.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { finalizationFixture } from "./finalization.js";

export const localImage =
  "public.ecr.aws/supabase/studio@sha256:06c541e63395ff1a06150189edd598ed393fd81ae09059ae7558d3220311c49f";
export const completeReport = {
  schema_version: "1.0.0",
  report_complete: true,
  discovered_tests: 1,
  error_count: 0,
  warning_count: 0,
  failure_class: null,
  tool_version: "FAKE-OFFLINE",
  fuzz: null,
};
export function hash(value: unknown) {
  const result = canonicalDigest(value);
  assert.ok(result.ok);
  return result.value;
}

export async function validationFixture(
  command?: RepositoryConfig["commands"][number],
  timeoutMs = 5_000,
) {
  const fixture = await finalizationFixture();
  const config = repositoryConfigSchema.parse(
    JSON.parse(await readFile("tests/fixtures/config.json", "utf8")),
  );
  config.validation_image = localImage;
  config.commands = [
    command ?? {
      check_id: "unit",
      kind: "test",
      report_format: "quorum-json-v1",
      executable: "node",
      args: ["wrapper.mjs"],
    },
  ];
  config.budgets.check_timeout_ms = timeoutMs;
  const candidate = createCandidateIdentity(
    {
      ...fixture.candidate.identity,
      configuration_digest: hash(config),
      validation_environment_digest: hash(validationEnvironment(config, {})),
    },
    { digest: canonicalDigest },
  );
  assert.ok(candidate.ok);
  const scratchRoot = join(fixture.rootDir, "sandbox");
  await mkdir(scratchRoot, { mode: 0o700 });
  return {
    ...fixture,
    config,
    candidate: candidate.value,
    scratchRoot,
    cleanup: async () => {
      // Fake-daemon fault fixtures intentionally retain read-only snapshots.
      for (const name of await readdir(scratchRoot)) {
        try {
          await chmod(join(scratchRoot, name, "snapshot"), 0o755);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await fixture.cleanup();
    },
  };
}
