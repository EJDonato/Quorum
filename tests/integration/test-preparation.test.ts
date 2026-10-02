import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { scheduleTestPreparation } from "../../src/application/schedule-test-preparation.js";
import { evaluateTestPreparation } from "../../src/application/evaluate-test-preparation.js";
import { createPreparationSnapshot } from "../../src/application/preparation-snapshots.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { verifyQaOverlay } from "../../src/infrastructure/validation/qa-overlay.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import { preparationExecutorFixture } from "../fixtures/preparation-executor.js";
import { completeReport, hash } from "../fixtures/validation.js";

await test("baseline and behavioral red run against separate frozen trees, persist bound evidence, and preserve dirty source", async () => {
  const f = await preparationExecutorFixture();
  try {
    await writeFile(join(f.options.sourceDir, "app.ts"), "human edits\n");
    f.git(f.options.sourceDir, ["add", "app.ts"]);
    const index = await readFile(join(f.options.sourceDir, ".git", "index"));
    const result = await scheduleTestPreparation({
      ...f.input,
      ports: f.ports,
    });
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.deepEqual(f.phases, ["baseline", "expected_red"]);
    assert.equal(result.value.reference.digest, hash(result.value.receipt));
    const records = await Promise.all(
      result.value.receipt.checks.map(async (ref) =>
        checkResultSchema.parse(
          JSON.parse(
            await readFile(
              join(f.options.artifactsDir, `${ref.ref.artifact_id}.json`),
              "utf8",
            ),
          ),
        ),
      ),
    );
    assert.deepEqual(
      records.map((record) => record.exit_code),
      [0, 1],
    );
    assert.deepEqual(records[1]?.failure_ids, ["value-contract"]);
    assert.ok(
      (
        await evaluateTestPreparation({
          ...f.input,
          receipt: result.value.receipt,
          ports: f.ports,
        })
      ).ok,
    );
    assert.deepEqual(
      await readFile(join(f.options.sourceDir, ".git", "index")),
      index,
    );
    assert.equal(
      await readFile(join(f.options.sourceDir, "app.ts"), "utf8"),
      "human edits\n",
    );
    assert.deepEqual(await readdir(f.scratchRoot), []);
  } finally {
    await f.cleanup();
  }
});

await test("every configured baseline check runs before the mapped red check", async () => {
  const f = await preparationExecutorFixture({
    extraCommands: [
      {
        check_id: "lint",
        kind: "lint",
        executable: "node",
        args: ["FAKE-LINT"],
        report_format: "quorum-json-v1",
      },
    ],
  });
  try {
    const result = await scheduleTestPreparation({
      ...f.input,
      ports: f.ports,
    });
    assert.ok(result.ok);
    assert.deepEqual(
      result.value.receipt.checks.map((item) => [item.phase, item.check_id]),
      [
        ["baseline", "lint"],
        ["baseline", "unit"],
        ["expected_red", "unit"],
      ],
    );
  } finally {
    await f.cleanup();
  }
});

for (const baseline of [
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "behavioral",
      error_count: 1,
    }),
  },
  { stdout: JSON.stringify({ ...completeReport, discovered_tests: 0 }) },
  { interrupted: "CANCELLED" as const },
])
  await test("baseline failure prevents red scheduling", async () => {
    const f = await preparationExecutorFixture({ baseline });
    try {
      const result = await scheduleTestPreparation({
        ...f.input,
        ports: f.ports,
      });
      assert.ok(!result.ok);
      assert.deepEqual(f.phases, ["baseline"]);
    } finally {
      await f.cleanup();
    }
  });

for (const red of [
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "infrastructure",
      error_count: 1,
      failure_ids: ["value-contract"],
    }),
  },
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "compiler",
      error_count: 1,
      failure_ids: ["value-contract"],
    }),
  },
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "behavioral",
      error_count: 1,
    }),
  },
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "behavioral",
      error_count: 1,
      failure_ids: ["unrelated"],
    }),
  },
  {
    exitCode: 1,
    stdout: JSON.stringify({
      ...completeReport,
      failure_class: "behavioral",
      error_count: 1,
      failure_ids: ["value-contract", "extra"],
    }),
  },
  { stdout: JSON.stringify(completeReport) },
  { interrupted: "CANCELLED" as const },
])
  await test("unmatched, incomplete, or infrastructure red evidence never accepts a test specification", async () => {
    const f = await preparationExecutorFixture({ red });
    try {
      assert.ok(
        !(await scheduleTestPreparation({ ...f.input, ports: f.ports })).ok,
      );
    } finally {
      await f.cleanup();
    }
  });

await test("direct compiler evidence and host-approved regression/documentation exceptions are distinct", async () => {
  for (const changeKind of ["contract", "refactor", "documentation"] as const) {
    const kind =
      changeKind === "contract"
        ? "typecheck"
        : changeKind === "documentation"
          ? "documentation"
          : "test";
    const f = await preparationExecutorFixture({
      changeKind,
      command: {
        check_id: "unit",
        kind,
        executable: "node",
        args: ["FAKE"],
        report_format: "quorum-json-v1",
      },
    });
    try {
      assert.ok(
        (await scheduleTestPreparation({ ...f.input, ports: f.ports })).ok,
      );
    } finally {
      await f.cleanup();
    }
  }
});

await test("QA overlay blocks production edits and existing-test weakening before check dispatch", async () => {
  const f = await preparationExecutorFixture();
  try {
    await writeFile(
      join(f.options.draftDir, "app.ts"),
      "unapproved production edit\n",
    );
    f.git(f.options.draftDir, ["add", "app.ts"]);
    const tree = {
      ...f.input.expectedRed.identity.tree,
      oid: f.git(f.options.draftDir, ["write-tree"]),
    };
    const snapshot = createPreparationSnapshot(
      { ...f.input.expectedRed.identity, tree },
      { digest: canonicalDigest },
    );
    assert.ok(snapshot.ok);
    const result = await scheduleTestPreparation({
      ...f.input,
      expectedRed: snapshot.value,
      ports: f.ports,
    });
    assert.ok(!result.ok && result.error.code === "SCOPE_DENIED");
    assert.deepEqual(f.phases, []);
    await writeFile(
      join(f.options.draftDir, "app.ts"),
      "export const value = 2;\n",
    );
    f.git(f.options.draftDir, ["add", "app.ts"]);
    await writeFile(
      join(f.options.draftDir, "tests", "regression.mjs"),
      "weakened\n",
    );
    f.git(f.options.draftDir, ["add", "tests/regression.mjs"]);
    const modified = createPreparationSnapshot(
      {
        ...f.input.expectedRed.identity,
        tree: { ...tree, oid: f.git(f.options.draftDir, ["write-tree"]) },
      },
      { digest: canonicalDigest },
    );
    assert.ok(modified.ok);
    const existingBaseline = createPreparationSnapshot(
      {
        ...f.input.expectedRed.identity,
        phase: "baseline",
        baseline_tree: f.input.expectedRed.identity.tree,
      },
      { digest: canonicalDigest },
    );
    const existingRed = createPreparationSnapshot(
      {
        ...modified.value.identity,
        baseline_tree: f.input.expectedRed.identity.tree,
      },
      { digest: canonicalDigest },
    );
    assert.ok(existingBaseline.ok && existingRed.ok);
    const overlay = await verifyQaOverlay({
      repository: f.options.draftDir,
      baseline: existingBaseline.value,
      expectedRed: existingRed.value,
      testPaths: ["tests"],
    });
    assert.ok(!overlay.ok && overlay.error.code === "SCOPE_DENIED");
  } finally {
    await f.cleanup();
  }
});
