import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { scheduleTestPreparation } from "../../src/application/schedule-test-preparation.js";
import { evaluateTestPreparation } from "../../src/application/evaluate-test-preparation.js";
import { failure } from "../../src/contracts/errors.js";
import { preparationExecutorFixture } from "../fixtures/preparation-executor.js";
import { completeReport, hash } from "../fixtures/validation.js";

await test("conflicting frozen input storage stops before any check launch", async () => {
  const f = await preparationExecutorFixture();
  try {
    await writeFile(
      join(
        f.options.artifactsDir,
        `preparation-config-${hash(f.input.config).slice(7)}.json`,
      ),
      "corrupted existing input\n",
    );
    assert.ok(
      !(await scheduleTestPreparation({ ...f.input, ports: f.ports })).ok,
    );
    assert.deepEqual(f.phases, []);
  } finally {
    await f.cleanup();
  }
});

await test("changed or forged evidence, missing checks, and receipt persistence failure block acceptance", async () => {
  const f = await preparationExecutorFixture();
  try {
    const result = await scheduleTestPreparation({
      ...f.input,
      ports: f.ports,
    });
    assert.ok(result.ok);
    const receipt = result.value.receipt;
    for (const altered of [
      { ...receipt, checks: receipt.checks.slice(1) },
      { ...receipt, checks: [...receipt.checks, ...receipt.checks] },
      { ...receipt, specification_digest: `sha256:${"f".repeat(64)}` },
      {
        ...receipt,
        checks: receipt.checks.map((check) => ({
          ...check,
          ref: { ...check.ref, digest: `sha256:${"f".repeat(64)}` },
        })),
      },
    ])
      assert.ok(
        !(
          await evaluateTestPreparation({
            ...f.input,
            receipt: altered,
            ports: f.ports,
          })
        ).ok,
      );
    const changedPorts = {
      ...f.ports,
      readArtifact: () =>
        Promise.resolve({
          ok: true as const,
          value: { ...completeReport, session_id: "forged" },
        }),
    };
    assert.ok(
      !(
        await evaluateTestPreparation({
          ...f.input,
          receipt,
          ports: changedPorts,
        })
      ).ok,
    );
    const failed = await scheduleTestPreparation({
      ...f.input,
      ports: {
        ...f.ports,
        persistReceipt: () =>
          Promise.resolve(failure("STORAGE_FAILED", "Injected failure")),
      },
    });
    assert.ok(!failed.ok && failed.error.code === "STORAGE_FAILED");
  } finally {
    await f.cleanup();
  }
});
