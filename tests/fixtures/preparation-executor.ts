import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryConfig } from "../../src/contracts/config.js";
import type { TestPreparationInput } from "../../src/application/test-preparation-input.js";
import { createTestPreparationPorts } from "../../src/infrastructure/validation/preparation-composition.js";
import { validationIntentSchema } from "../../src/contracts/validation.js";
import { fakeDocker } from "./fake-docker.js";
import { validationFixture, completeReport } from "./validation.js";
import { preparationInput } from "./test-preparation.js";

export async function preparationExecutorFixture(
  options: {
    changeKind?: TestPreparationInput["policy"]["changeKind"];
    command?: RepositoryConfig["commands"][number];
    extraCommands?: RepositoryConfig["commands"];
    red?: Parameters<typeof fakeDocker>[0];
    baseline?: Parameters<typeof fakeDocker>[0];
  } = {},
) {
  const fixture = await validationFixture(options.command);
  fixture.config.commands.push(...(options.extraCommands ?? []));
  const baselineTree = fixture.candidate.identity.tree;
  await mkdir(join(fixture.options.draftDir, "tests"));
  await writeFile(
    join(fixture.options.draftDir, "tests", "regression.mjs"),
    "// FAKE authored regression\n",
  );
  fixture.git(fixture.options.draftDir, ["add", "tests/regression.mjs"]);
  const redTree = {
    format: baselineTree.format,
    oid: fixture.git(fixture.options.draftDir, ["write-tree"]),
  };
  const input = preparationInput({
    config: fixture.config,
    sessionId: fixture.options.sessionId,
    baselineTree,
    redTree,
    ...(options.changeKind ? { changeKind: options.changeKind } : {}),
  });
  const phases: string[] = [];
  let daemon = fakeDocker();
  const ports = createTestPreparationPorts({
    input,
    invocationId: "qa-preparation",
    artifactsDir: fixture.options.artifactsDir,
    authorize: () =>
      Promise.resolve({ ok: true, value: { remainingMs: 5_000 } }),
    sandbox: {
      repository: fixture.options.draftDir,
      scratchRoot: fixture.scratchRoot,
      socketPath: "/fake/docker.sock",
      dockerExecutable: "/fake/docker",
      process: async (call) => {
        if (call.args.includes("create")) {
          const intent = validationIntentSchema.parse(
            JSON.parse(await readFile(join(call.cwd, "owner.json"), "utf8")),
          );
          const phase = intent.input.phase;
          phases.push(phase);
          const needsRed =
            input.policy.changeKind === "behavior" ||
            input.policy.changeKind === "contract";
          daemon = fakeDocker(
            phase === "baseline"
              ? (options.baseline ?? {})
              : (options.red ??
                  (needsRed
                    ? {
                        exitCode: 1,
                        stdout: JSON.stringify({
                          ...completeReport,
                          error_count: 1,
                          failure_class:
                            input.policy.changeKind === "contract"
                              ? "compiler"
                              : "behavioral",
                          failure_ids: [
                            input.policy.changeKind === "contract"
                              ? "TS2322"
                              : "value-contract",
                          ],
                        }),
                      }
                    : {})),
          );
        }
        return daemon.process(call);
      },
    },
  });
  return { ...fixture, input, ports, phases };
}
