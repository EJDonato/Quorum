// Explicit opt-in real container evidence. No model calls or live services.
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import { createTestPreparationPorts } from "../../src/infrastructure/validation/preparation-composition.js";
import { scheduleTestPreparation } from "../../src/application/schedule-test-preparation.js";
import { preparationExecutorFixture } from "../fixtures/preparation-executor.js";
import { preparationInput } from "../fixtures/test-preparation.js";

const image = process.env.QUORUM_VALIDATION_IMAGE;
const socketPath = process.env.QUORUM_VALIDATION_SOCKET;
const dockerExecutable = process.env.QUORUM_VALIDATION_DOCKER;
assert.ok(
  image && socketPath && dockerExecutable,
  "Use test:validation:container explicitly.",
);

async function liveFixture(infrastructureFailure = false) {
  const script = `void(async()=>{const fs=require('node:fs');const assert=require('node:assert/strict');
    assert.match(fs.readFileSync('/workspace/app.ts','utf8'),/value = 2/);
    let failed=false;let classification=null;
    if(fs.existsSync('/workspace/tests/regression.mjs')){
      try{await import('file:///workspace/tests/regression.mjs');}
      catch(error){failed=true;classification=error.code==='ERR_ASSERTION'?'behavioral':'infrastructure';}
    }
    console.log(JSON.stringify({schema_version:'1.0.0',report_complete:true,
      discovered_tests:1,error_count:failed?1:0,warning_count:0,failure_class:classification,
      failure_ids:failed?['value-contract']:[],tool_version:process.version,fuzz:null}));
    process.exitCode=failed?1:0;})();`;
  const f = await preparationExecutorFixture({
    command: {
      check_id: "unit",
      kind: "test",
      executable: "node",
      args: ["-e", script],
      report_format: "quorum-json-v1",
    },
  });
  await writeFile(
    join(f.options.draftDir, "tests", "regression.mjs"),
    infrastructureFailure
      ? "import '/workspace/quorum-missing-dependency.mjs';\n"
      : "import assert from 'node:assert/strict';import fs from 'node:fs';assert.match(fs.readFileSync('/workspace/app.ts','utf8'),/value = 3/);\n",
  );
  f.git(f.options.draftDir, ["add", "tests/regression.mjs"]);
  const redTree = {
    ...f.input.expectedRed.identity.tree,
    oid: f.git(f.options.draftDir, ["write-tree"]),
  };
  const config = repositoryConfigSchema.parse(f.input.config);
  config.validation_image = image ?? "";
  config.budgets.check_timeout_ms = 30_000;
  const input = preparationInput({
    config,
    sessionId: f.options.sessionId,
    baselineTree: f.input.baseline.identity.tree,
    redTree,
  });
  const ports = createTestPreparationPorts({
    input,
    invocationId: "live-qa-preparation",
    artifactsDir: f.options.artifactsDir,
    authorize: () =>
      Promise.resolve({ ok: true, value: { remainingMs: 30_000 } }),
    sandbox: {
      repository: f.options.draftDir,
      scratchRoot: f.scratchRoot,
      socketPath: socketPath ?? "",
      dockerExecutable: dockerExecutable ?? "",
    },
  });
  return { ...f, input, ports };
}

await test("real containers establish passing baseline and a matching behavioral assertion failure", async () => {
  const f = await liveFixture();
  try {
    const result = await scheduleTestPreparation({
      ...f.input,
      ports: f.ports,
    });
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    const records = await Promise.all(
      result.value.receipt.checks.map(async (item) =>
        checkResultSchema.parse(
          JSON.parse(
            await readFile(
              join(f.options.artifactsDir, `${item.ref.artifact_id}.json`),
              "utf8",
            ),
          ),
        ),
      ),
    );
    assert.deepEqual(
      records.map((item) => item.input.phase),
      ["baseline", "expected_red"],
    );
    assert.deepEqual(
      records.map((item) => item.exit_code),
      [0, 1],
    );
    assert.equal(records[1]?.failure_class, "behavioral");
    assert.deepEqual(records[1]?.failure_ids, ["value-contract"]);
    assert.deepEqual(await readdir(f.scratchRoot), []);
  } finally {
    await f.cleanup();
  }
});

await test("real missing dependency cannot establish expected behavioral red", async () => {
  const f = await liveFixture(true);
  try {
    const result = await scheduleTestPreparation({
      ...f.input,
      ports: f.ports,
    });
    assert.ok(!result.ok && result.error.code === "CHECK_FAILED");
    assert.equal(
      (await readdir(f.options.artifactsDir)).some((name) =>
        name.startsWith("test-preparation-"),
      ),
      false,
    );
    assert.deepEqual(await readdir(f.scratchRoot), []);
  } finally {
    await f.cleanup();
  }
});
