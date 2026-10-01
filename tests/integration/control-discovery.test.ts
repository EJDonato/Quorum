import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureProcess } from "../probes/process.js";
import { discoverControls } from "../probes/control-discovery.js";
import { inertBrokerCall } from "../probes/inert-broker.js";

async function fakeRunner(
  cwd: string,
  runner: "codex" | "agy",
  version = "1.2.14",
) {
  const path = join(cwd, "fake-control-runner");
  const script = `#!${process.execPath}\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst args = process.argv.slice(2);\nif (args.includes('--version')) process.stdout.write(${JSON.stringify(runner === "codex" ? `codex-cli ${version}` : version)});\nelse if (args.includes('features')) process.stdout.write('shell_tool stable false\\nunified_exec stable true\\ntoken_budget under-development false\\nrollout_budget under-development false\\nsecret-fixture-value\\n');\nelse if (args.includes('generate-json-schema')) { const dir = join(args[args.indexOf('--out') + 1], 'v2'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'ThreadStartParams.json'), JSON.stringify({properties:{dynamicTools:{}}})); writeFileSync(join(dir, 'TurnStartParams.json'), JSON.stringify({properties:{outputSchema:{}}})); }\nelse process.stdout.write('help secret-fixture-value');\n`;
  await writeFile(path, script, { mode: 0o700 });
  return path;
}

await test("metadata discovery records feature registry and protocol fields without granting capability", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-controls-test-"));
  try {
    const executable = await fakeRunner(cwd, "codex");
    const report = await discoverControls({
      runner: "codex",
      executable,
      expectedVersion: "1.2.14",
      cwd,
    });
    assert.deepEqual(
      report.steps.map((step) => step.id),
      ["version", "help", "features", "protocol_schema"],
    );
    assert.equal(report.known_features.unified_exec, true);
    assert.equal(report.known_features.shell_tool, false);
    assert.equal(report.protocol_fields.dynamic_tools, true);
    assert.equal(report.protocol_fields.output_schema, true);
    assert.ok(
      Object.values(report.capability_observations).every(
        (value) => value === "UNVERIFIED",
      ),
    );
    assert.equal(report.enforced_conformance, false);
    assert.doesNotMatch(JSON.stringify(report), /secret-fixture-value/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("version mismatch and missing executable preserve failure without probing controls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-controls-test-"));
  try {
    const executable = await fakeRunner(cwd, "agy");
    const mismatch = await discoverControls({
      runner: "agy",
      executable,
      expectedVersion: "1.2.13",
      cwd,
    });
    assert.deepEqual(
      mismatch.steps.map((step) => step.id),
      ["version"],
    );
    assert.equal(mismatch.steps[0]?.failure, "VERSION_MISMATCH");
    const missing = await discoverControls({
      runner: "agy",
      executable: join(cwd, "missing"),
      expectedVersion: "1.2.14",
      cwd,
    });
    assert.equal(missing.steps[0]?.failure, "LAUNCH_FAILED");
    assert.ok(
      Object.values(missing.capability_observations).every(
        (value) => value === "UNVERIFIED",
      ),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("CLI writes intent and a failed report without leaking runner output", async () => {
  const base = await mkdtemp(join(tmpdir(), "quorum-controls-test-"));
  try {
    const executable = await fakeRunner(base, "agy", "bad-version");
    const capture = await captureProcess({
      executable: process.execPath,
      args: [
        "scripts/probe-controls.mjs",
        "--runner",
        "agy",
        "--executable",
        executable,
        "--expected-version",
        "1.2.14",
        "--report-dir",
        base,
      ],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    assert.equal(capture.exitCode, 1);
    const directories = (await readdir(base)).filter((name) =>
      name.startsWith("quorum-controls-"),
    );
    assert.equal(directories.length, 1);
    const reportDir = join(base, directories[0] ?? "");
    const intent = JSON.parse(
      await readFile(join(reportDir, "intent.json"), "utf8"),
    ) as unknown;
    const report = JSON.parse(
      await readFile(join(reportDir, "report.json"), "utf8"),
    ) as unknown;
    assert.equal(typeof intent, "object");
    assert.equal(typeof report, "object");
    assert.match(JSON.stringify(report), /INVALID_PROTOCOL/);
    assert.doesNotMatch(JSON.stringify(report), /secret-fixture-value/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

await test("inert broker fixture denies unauthorized tools, paths, and forged authority", () => {
  assert.equal(
    inertBrokerCall({ tool: "repo.read", path: "fixture.txt" }),
    "QUORUM_FIXTURE",
  );
  for (const input of [
    { tool: "shell", command: "git push" },
    { tool: "repo.read", path: "../source/.git/config" },
    { tool: "repo.read", path: "/private/secrets" },
    { tool: "artifact.write", path: "report.json" },
    { tool: "http.request", url: "https://example.invalid" },
    { tool: "delegate", role: "developer" },
    { tool: "repo.read", path: "fixture.txt", session_id: "forged" },
  ])
    assert.equal(inertBrokerCall(input), "DENIED");
});

await test("binary mutation during version discovery blocks all later inspection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-controls-test-"));
  try {
    const executable = join(cwd, "changing-runner");
    await writeFile(
      executable,
      `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nif (process.argv.includes('--version')) { process.stdout.write('1.2.14\\n'); appendFileSync(process.argv[1], '\\n// changed'); } else process.exitCode = 42;\n`,
      { mode: 0o700 },
    );
    const report = await discoverControls({
      runner: "agy",
      executable,
      expectedVersion: "1.2.14",
      cwd,
    });
    assert.equal(report.binary_unchanged, false);
    assert.equal(report.steps[0]?.failure, "BINARY_CHANGED");
    assert.equal(report.steps.length, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("control CLI rejects a live flag before launching a runner", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-controls-test-"));
  try {
    const executable = await fakeRunner(cwd, "agy");
    const capture = await captureProcess({
      executable: process.execPath,
      args: [
        "scripts/probe-controls.mjs",
        "--live",
        "--runner",
        "agy",
        "--executable",
        executable,
        "--expected-version",
        "1.2.14",
        "--report-dir",
        cwd,
      ],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    assert.notEqual(capture.exitCode, 0);
    assert.equal(
      (await readdir(cwd)).filter((name) => name.startsWith("quorum-controls-"))
        .length,
      0,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
