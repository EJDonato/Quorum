import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initRepository } from "../../src/application/init.js";
import { executeCommand } from "../../src/cli/commands.js";
import { dispatchReplLine } from "../../src/cli/repl-actions.js";
import type { ReplIo, ReplState } from "../../src/cli/repl-types.js";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { CANONICAL_PROMPT_TEMPLATES } from "../../src/prompts/defaults.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "quorum-init-test-"));
}

await test("initRepository creates .quorum/config.json and all persona templates", async () => {
  const rootDir = await makeTempDir();
  try {
    const outcome = await initRepository({ rootDir, adapter: "codex" });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    assert.equal(outcome.value.configCreated, true);
    assert.equal(outcome.value.createdPersonas.length, 8);
    assert.equal(outcome.value.preservedPersonas.length, 0);
    assert.ok(outcome.value.disclosure.includes("Disclosure:"));

    // Verify config is valid against repositoryConfigSchema
    const configRaw = await readFile(outcome.value.configPath, "utf8");
    const parsedConfig = repositoryConfigSchema.parse(JSON.parse(configRaw));
    assert.equal(parsedConfig.adapter.name, "codex");
    assert.equal(parsedConfig.schema_version, "1.0.0");
    assert.equal(parsedConfig.commands.length, 2);

    // Verify persona templates
    for (const [key, expectedContent] of Object.entries(
      CANONICAL_PROMPT_TEMPLATES,
    )) {
      const templateFile = join(outcome.value.agentsDir, `${key}.md`);
      const fileContent = await readFile(templateFile, "utf8");
      assert.equal(fileContent.trim(), expectedContent.trim());
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("initRepository does not overwrite existing configuration or personas", async () => {
  const rootDir = await makeTempDir();
  try {
    const first = await initRepository({ rootDir, adapter: "agy" });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Mutate existing config.json to ensure it is not overwritten
    const modifiedConfig = { custom: "preserved-field" };
    await writeFile(
      first.value.configPath,
      JSON.stringify(modifiedConfig),
      "utf8",
    );

    // Mutate developer persona template to ensure it is not overwritten
    const customDevPrompt = "Custom Developer Instructions";
    await writeFile(
      join(first.value.agentsDir, "developer.md"),
      customDevPrompt,
      "utf8",
    );

    // Run initRepository a second time
    const second = await initRepository({ rootDir, adapter: "codex" });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    assert.equal(second.value.configCreated, false);
    assert.ok(second.value.preservedPersonas.includes("developer"));
    assert.equal(second.value.createdPersonas.length, 0);

    // Verify modified config was preserved
    const configAfter = JSON.parse(
      await readFile(first.value.configPath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(configAfter.custom, "preserved-field");

    // Verify modified persona was preserved
    const devPromptAfter = await readFile(
      join(first.value.agentsDir, "developer.md"),
      "utf8",
    );
    assert.equal(devPromptAfter, customDevPrompt);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("executeCommand supports quorum init with arguments and json output", async () => {
  const rootDir = await makeTempDir();
  const dummyPort = {
    read: () => Promise.reject(new Error("unsupported")),
  };
  try {
    const invalidAdapter = await executeCommand(
      ["init", "--adapter", "unsupported-runner"],
      dummyPort,
    );
    assert.equal(invalidAdapter.exitCode, 2);

    const invalidMode = await executeCommand(
      ["init", "--mode", "unsupported-mode"],
      dummyPort,
    );
    assert.equal(invalidMode.exitCode, 2);

    const success = await executeCommand(
      [
        "init",
        "--root",
        rootDir,
        "--adapter",
        "agy",
        "--mode",
        "advisory",
        "--json",
      ],
      dummyPort,
    );
    assert.equal(success.exitCode, 0);
    assert.equal(success.json, true);
    const body = success.body as { ok: boolean; configCreated: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.configCreated, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("dispatchReplLine handles /init command", async () => {
  const rootDir = await makeTempDir();
  try {
    const state: ReplState = {
      rootDir,
      configPath: join(rootDir, ".quorum", "config.json"),
      activeRunner: "codex",
      exitRequested: false,
      activeSessionId: null,
    };
    const io: ReplIo = {
      readConfig: async (p) => ({
        ok: true,
        value: JSON.parse(await readFile(p, "utf8")),
      }),
    };

    const result = await dispatchReplLine(state, io, "/init");
    assert.ok(
      result.text.includes("Quorum repository initialized successfully"),
    );
    assert.ok(result.text.includes("Created configuration"));
    assert.ok(result.text.includes("Disclosure:"));

    // Second execution reports preserved configuration
    const secondResult = await dispatchReplLine(state, io, "/init");
    assert.ok(secondResult.text.includes("Preserved existing configuration"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
