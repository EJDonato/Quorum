import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  executeBrokerTool,
  type BrokerSessionContext,
} from "../../src/broker/broker.js";
import { createValidationCheckPort } from "../../src/infrastructure/validation/composition.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import { checkPassed } from "../../src/domain/checks.js";
import { completeReport, validationFixture } from "../fixtures/validation.js";
import { fakeDocker } from "../fixtures/fake-docker.js";

async function setup(fakeOptions: Parameters<typeof fakeDocker>[0] = {}) {
  const fixture = await validationFixture();
  const fake = fakeDocker(fakeOptions);
  const port = createValidationCheckPort({
    config: fixture.config,
    candidate: fixture.candidate,
    sessionId: fixture.options.sessionId,
    invocationId: "check-invocation",
    checkIds: ["unit"],
    artifactsDir: fixture.options.artifactsDir,
    environment: {},
    authorize: () =>
      Promise.resolve({ ok: true, value: { remainingMs: 5_000 } }),
    sandbox: {
      repository: fixture.options.draftDir,
      scratchRoot: fixture.scratchRoot,
      dockerExecutable: "/fake/docker",
      socketPath: "/fake/docker.sock",
      process: fake.process,
    },
  });
  assert.ok(port.ok);
  const context: BrokerSessionContext = {
    sessionId: fixture.options.sessionId,
    invocationId: "check-invocation",
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    draftDir: fixture.options.draftDir,
    artifactsDir: fixture.options.artifactsDir,
    grantedPaths: ["app.ts"],
    protectedPaths: [],
    checks: port.value,
  };
  const run = () =>
    executeBrokerTool(context, {
      tool: "checks.run",
      params: {
        check_id: "unit",
        input_digest: fixture.candidate.candidate_id,
      },
    });
  return { ...fixture, fake, context, run };
}

await test("configured check persists candidate-bound host evidence from a private Git snapshot", async () => {
  const fixture = await setup();
  try {
    const sourceIndex = await readFile(
      join(fixture.options.sourceDir, ".git", "index"),
    );
    // Drift in the mutable draft must not enter a check of the recorded tree.
    await writeFile(
      join(fixture.options.draftDir, "app.ts"),
      "unfrozen modification\n",
    );
    const result = await fixture.run();
    assert.ok(result.ok);
    const output = result.value as {
      status: string;
      evidence_ref: string;
      execution_id: string;
    };
    assert.equal(output.status, "PASSED");
    const record = checkResultSchema.parse(
      JSON.parse(
        await readFile(
          join(fixture.options.artifactsDir, `${output.evidence_ref}.json`),
          "utf8",
        ),
      ),
    );
    assert.ok(checkPassed(record));
    assert.equal(record.session_id, fixture.options.sessionId);
    assert.deepEqual(record.input, {
      phase: "final",
      candidate_id: fixture.candidate.candidate_id,
    });
    assert.notEqual(record.stdout_ref.digest, `sha256:${"0".repeat(64)}`);
    assert.ok(
      (
        await readFile(
          join(
            fixture.options.artifactsDir,
            "checks",
            output.execution_id,
            "intent.json",
          ),
        )
      ).length,
    );
    assert.ok(
      (
        await readFile(
          join(
            fixture.options.artifactsDir,
            "checks",
            output.execution_id,
            "completion.json",
          ),
        )
      ).length,
    );
    const create = fixture.fake.calls.find((call) =>
      call.args.includes("create"),
    );
    assert.ok(create);
    assert.equal(
      create.args.filter((arg) => arg.startsWith("type=bind")).length,
      1,
    );
    assert.ok(create.args.includes("--pull=never"));
    assert.ok(create.args.includes("--network=none"));
    assert.ok(fixture.fake.environments[0]?.includes("HOST_SECRET_FORBIDDEN="));
    assert.ok(create.args.includes("--env-file"));
    assert.equal(JSON.stringify(create.env).includes("BAKED_FIXTURE"), false);
    assert.equal(
      JSON.stringify(create.args).includes(fixture.options.sourceDir),
      false,
    );
    assert.equal(
      JSON.stringify(create.args).includes(fixture.options.artifactsDir),
      false,
    );
    assert.deepEqual(
      await readFile(join(fixture.options.sourceDir, ".git", "index")),
      sourceIndex,
    );
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    await fixture.cleanup();
  }
});

for (const [name, fake, expected] of [
  [
    "zero test discovery",
    { stdout: JSON.stringify({ ...completeReport, discovered_tests: 0 }) },
    "FAILED",
  ],
  ["malformed report", { stdout: "not JSON" }, "BLOCKED"],
  ["missing report", { stdout: "" }, "BLOCKED"],
  [
    "incomplete report",
    { stdout: JSON.stringify({ ...completeReport, report_complete: false }) },
    "BLOCKED",
  ],
  [
    "forged host fields",
    { stdout: JSON.stringify({ ...completeReport, candidate_id: "forged" }) },
    "BLOCKED",
  ],
  ["nonzero tool exit", { exitCode: 1 }, "FAILED"],
  ["missing tool exit", { exitCode: 127 }, "BLOCKED"],
  ["timeout", { interrupted: "CANCELLED" as const }, "BLOCKED"],
  ["output overflow", { interrupted: "STORAGE_FAILED" as const }, "BLOCKED"],
] as const) {
  await test(`${name} cannot establish a passing check`, async () => {
    const fixture = await setup(fake);
    try {
      const result = await fixture.run();
      assert.ok(result.ok);
      assert.equal((result.value as { status: string }).status, expected);
      assert.ok(fixture.fake.calls.some((call) => call.args.includes("rm")));
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const fake of [
  { imageMissing: true },
  { createFailure: true },
  { cleanupFailure: true },
  { wrongOwner: true },
]) {
  await test(`unavailable or unconfirmed sandbox blocks: ${JSON.stringify(fake)}`, async () => {
    const fixture = await setup(fake);
    try {
      assert.equal((await fixture.run()).ok, false);
      const files = await readdir(fixture.options.artifactsDir);
      assert.equal(
        files.some((name) => /^[a-f0-9]{32}\.json$/.test(name)),
        false,
      );
    } finally {
      await fixture.cleanup();
    }
  });
}

await test("broker blocks stale revisions, foreign invocations, ungranted IDs, and command injection before launch", async () => {
  const fixture = await setup();
  try {
    for (const params of [
      { check_id: "unit", input_digest: `sha256:${"f".repeat(64)}` },
      { check_id: "other", input_digest: fixture.candidate.candidate_id },
      {
        check_id: "unit",
        input_digest: fixture.candidate.candidate_id,
        executable: "sh",
        args: ["-c", "echo forged"],
      },
    ])
      assert.equal(
        (
          await executeBrokerTool(fixture.context, {
            tool: "checks.run",
            params,
          })
        ).ok,
        false,
      );
    assert.equal(
      (
        await executeBrokerTool(
          { ...fixture.context, invocationId: "foreign" },
          {
            tool: "checks.run",
            params: {
              check_id: "unit",
              input_digest: fixture.candidate.candidate_id,
            },
          },
        )
      ).ok,
      false,
    );
    assert.equal(
      (
        await executeBrokerTool(
          { ...fixture.context, role: "QA", phase: "REVIEWING" },
          {
            tool: "checks.run",
            params: {
              check_id: "unit",
              input_digest: fixture.candidate.candidate_id,
            },
          },
        )
      ).ok,
      false,
    );
    assert.equal(fixture.fake.calls.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

for (const alter of [
  (
    c: import("../../src/infrastructure/validation/docker-profile.js").ContainerInspection,
  ) => {
    c.HostConfig.NetworkMode = "host";
  },
  (
    c: import("../../src/infrastructure/validation/docker-profile.js").ContainerInspection,
  ) => {
    if (c.Mounts[0]) c.Mounts[0].RW = true;
  },
  (
    c: import("../../src/infrastructure/validation/docker-profile.js").ContainerInspection,
  ) => {
    c.HostConfig.Privileged = true;
  },
  (
    c: import("../../src/infrastructure/validation/docker-profile.js").ContainerInspection,
  ) => {
    c.Mounts.push({
      Type: "bind",
      Source: "/var/run/docker.sock",
      Destination: "/var/run/docker.sock",
      RW: true,
    });
  },
]) {
  await test("unexpected daemon isolation settings are rejected before start", async () => {
    const fixture = await setup({ alter });
    try {
      assert.equal((await fixture.run()).ok, false);
      assert.equal(
        fixture.fake.calls.some((call) => call.args.includes("start")),
        false,
      );
    } finally {
      await fixture.cleanup();
    }
  });
}
