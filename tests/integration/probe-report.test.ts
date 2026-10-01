import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { captureProcess } from "../probes/process.js";
import { runSchemaProbe } from "../probes/report.js";

async function fakeRunner(directory: string, version: string, failure = false) {
  const path = join(directory, "fake-runner");
  const envelope = JSON.stringify({
    status: "SUCCESS",
    response: '{"marker":"QUORUM_OK","sum":5}',
    structured_output: { marker: "QUORUM_OK", sum: 5 },
    usage: { input_tokens: 10, output_tokens: 4 },
  });
  await writeFile(
    path,
    `#!${process.execPath}\nif (process.argv.includes('--version')) {
    process.stdout.write(${JSON.stringify(version)});
  } else {
    process.stderr.write(${JSON.stringify(failure ? "authentication failed fixture-secret" : "")});
    process.stdout.write(${JSON.stringify(failure ? "invalid fixture-secret" : envelope)});
    process.exitCode = ${failure ? 1 : 0};
  }\n`,
    { mode: 0o700 },
  );
  return path;
}

await test("version guards refuse mismatches before a model attempt and preserve failure metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-report-test-"));
  try {
    const executable = await fakeRunner(cwd, "1.2.14");
    const result = await runSchemaProbe({
      runner: "agy",
      model: "synthetic-fixture",
      executable,
      expectedVersion: "1.2.13",
      cwd,
      schemaPath: join(cwd, "schema.json"),
    });
    assert.equal(result.execution_failure, "VERSION_MISMATCH");
    assert.equal(result.attempts, 0);
    assert.equal(result.runner_version, "1.2.14");
    assert.equal(result.result.ok, false);
    const missing = await runSchemaProbe({
      runner: "agy",
      model: "synthetic-fixture",
      executable: join(cwd, "absent"),
      expectedVersion: "1.2.14",
      cwd,
      schemaPath: "unused",
    });
    assert.equal(missing.execution_failure, "INFRASTRUCTURE_FAILED");
    assert.equal(missing.attempts, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("success and failed attempts retain fixed diagnostics without secrets or enforcement claims", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-report-test-"));
  try {
    for (const failure of [false, true]) {
      const executable = await fakeRunner(cwd, "1.2.14", failure);
      const result = await runSchemaProbe({
        runner: "agy",
        model: "synthetic-fixture",
        executable,
        expectedVersion: "1.2.14",
        cwd,
        schemaPath: "unused",
      });
      assert.equal(result.result.ok, !failure);
      assert.equal(result.attempts, 1);
      assert.equal(result.enforced_conformance, false);
      assert.equal(result.hard_token_ceiling, false);
      assert.equal(result.cleanup_confirmed, false);
      assert.equal(result.schema_version, "1.1.0");
      assert.ok(result.timings_ms.version_discovery !== null);
      assert.ok(result.timings_ms.invocation !== null);
      assert.ok(result.timings_ms.total >= result.timings_ms.invocation);
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
      if (failure)
        assert.deepEqual(result.diagnostic_codes, ["AUTHENTICATION"]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("probe CLI preserves private intent and failure reports even when version discovery fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-report-test-"));
  try {
    const executable = await fakeRunner(cwd, "invalid-version");
    const result = await captureProcess({
      executable: process.execPath,
      args: [
        "scripts/probe-runners.mjs",
        "--live",
        "--runner",
        "agy",
        "--model",
        "synthetic-fixture",
        "--expected-version",
        "1.2.14",
        "--executable",
        executable,
        "--report-dir",
        cwd,
      ],
      cwd: resolve("."),
      timeoutMs: 2_000,
    });
    assert.equal(result.exitCode, 1);
    const directory = (await readdir(cwd)).find((name) =>
      name.startsWith("quorum-probe-"),
    );
    assert.ok(directory);
    assert.equal((await stat(join(cwd, directory))).mode & 0o777, 0o700);
    for (const file of ["intent.json", "report.json"]) {
      assert.equal(
        (await stat(join(cwd, directory, file))).mode & 0o777,
        0o600,
      );
    }
    const intent: unknown = JSON.parse(
      await readFile(join(cwd, directory, "intent.json"), "utf8"),
    );
    assert.ok(
      typeof intent === "object" &&
        intent !== null &&
        "max_model_attempts" in intent,
    );
    assert.equal(intent.max_model_attempts, 1);
    const report: unknown = JSON.parse(
      await readFile(join(cwd, directory, "report.json"), "utf8"),
    );
    assert.ok(
      typeof report === "object" &&
        report !== null &&
        "execution_failure" in report,
    );
    assert.equal(report.execution_failure, "VERSION_DISCOVERY_FAILED");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("binary modification during version discovery blocks the request", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-report-test-"));
  try {
    const executable = join(cwd, "fake-self-modifying-runner");
    await writeFile(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs');
      fs.appendFileSync(__filename, '\\n// synthetic changed binary');
      process.stdout.write('1.2.14');\n`,
      { mode: 0o700 },
    );
    const result = await runSchemaProbe({
      runner: "agy",
      model: "synthetic-fixture",
      executable,
      expectedVersion: "1.2.14",
      cwd,
      schemaPath: "unused",
    });
    assert.equal(result.execution_failure, "BINARY_CHANGED");
    assert.equal(result.attempts, 0);
    assert.equal(result.version_exit_code, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
