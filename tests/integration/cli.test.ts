import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { readConfiguration } from "../../src/infrastructure/configuration.js";
import { executeCommand } from "../../src/cli/commands.js";
import { present } from "../../src/cli/presentation.js";

const execute = promisify(execFile);
const executable = resolve("dist/src/cli/main.js");
const fixture = resolve("tests/fixtures/config.json");

await test("built CLI emits versioned JSON with clean stdout and validates the fixture", async () => {
  const output = await execute(process.execPath, [
    executable,
    "config",
    "--config",
    fixture,
    "--json",
  ]);
  assert.equal(output.stderr, "");
  const body: unknown = JSON.parse(output.stdout);
  assert.deepEqual(body, {
    schema_version: "1.0.0",
    ok: true,
    configuration_valid: true,
  });
  const help = await execute(process.execPath, [executable, "--help"]);
  assert.match(help.stdout, /Quorum foundation/);
});

await test("doctor fails closed in both enforced and advisory mode and never launches a runner", async () => {
  const configuration = await readConfiguration(fixture);
  assert.equal(configuration.ok, true);
  for (const mode of ["enforced", "advisory"]) {
    const raw: unknown = configuration.value;
    assert.ok(typeof raw === "object" && raw !== null);
    const result = await executeCommand(["doctor", "--json"], {
      read: () => Promise.resolve({ ok: true, value: { ...raw, mode } }),
    });
    assert.equal(result.exitCode, 3);
    assert.match(present(result).stdout, /"ready":false/);
    assert.match(present(result).stdout, /unverified/);
  }
});

await test("invalid CLI input, missing configuration, and unsupported commands have explicit exit codes", async () => {
  const port = { read: readConfiguration };
  assert.equal((await executeCommand(["--bad-flag"], port)).exitCode, 2);
  assert.equal((await executeCommand(["unknown"], port)).exitCode, 2);
  assert.equal((await executeCommand(["config", "extra"], port)).exitCode, 2);
  assert.equal(
    (
      await executeCommand(
        ["config", "--config", "tests/fixtures/absent.json"],
        port,
      )
    ).exitCode,
    4,
  );
  for (const command of ["run", "commit", "resume", "clean", "dispatch"]) {
    const result = await executeCommand([command, "--json"], port);
    assert.equal(result.exitCode, 3);
    assert.match(present(result).stdout, /CAPABILITY_MISSING/);
  }
});

await test("configuration reads preserve existing files and reject malformed, oversized, or linked inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorum-config-"));
  try {
    const path = join(directory, "config.json");
    const bytes = await readFile(fixture);
    await writeFile(path, bytes);
    assert.equal((await readConfiguration(path)).ok, true);
    assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(await readdir(directory), ["config.json"]);
    await symlink(path, join(directory, "linked.json"));
    assert.equal(
      (await readConfiguration(join(directory, "linked.json"))).ok,
      false,
    );
    await writeFile(path, '{"api_key":"fixture-secret",');
    const result = await executeCommand(
      ["config", "--config", path, "--json"],
      { read: readConfiguration },
    );
    assert.equal(result.exitCode, 2);
    assert.doesNotMatch(present(result).stdout, /fixture-secret/);
    await writeFile(path, " ".repeat(65_537));
    assert.equal((await readConfiguration(path)).ok, false);
    assert.equal((await readConfiguration(directory)).ok, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("terminal diagnostics escape control sequences", () => {
  const result = present({
    exitCode: 3,
    json: false,
    body: {},
    text: "Unsafe\u001b[31m\u009btest",
  });
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /[\u001b\u009b]/);
  assert.match(result.stderr, /\\u001b/);
});
