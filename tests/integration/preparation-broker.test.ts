import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createValidationCheckPort } from "../../src/infrastructure/validation/composition.js";
import {
  executeBrokerTool,
  type BrokerSessionContext,
} from "../../src/broker/broker.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import { preparationExecutorFixture } from "../fixtures/preparation-executor.js";
import { fakeDocker } from "../fixtures/fake-docker.js";

await test("QA checks.run accepts its host-bound baseline and rejects final or stale input identities", async () => {
  const f = await preparationExecutorFixture();
  const daemon = fakeDocker();
  try {
    const port = createValidationCheckPort({
      config: f.input.config,
      snapshot: f.input.baseline,
      sessionId: f.options.sessionId,
      invocationId: "qa-preparation",
      checkIds: ["unit"],
      artifactsDir: f.options.artifactsDir,
      environment: {},
      authorize: () =>
        Promise.resolve({ ok: true, value: { remainingMs: 5_000 } }),
      sandbox: {
        repository: f.options.draftDir,
        scratchRoot: f.scratchRoot,
        socketPath: "/fake/docker.sock",
        dockerExecutable: "/fake/docker",
        process: daemon.process,
      },
    });
    assert.ok(port.ok);
    const context: BrokerSessionContext = {
      sessionId: f.options.sessionId,
      invocationId: "qa-preparation",
      role: "QA",
      phase: "TEST_SPEC",
      draftDir: f.options.draftDir,
      artifactsDir: f.options.artifactsDir,
      grantedPaths: ["tests"],
      protectedPaths: ["app.ts"],
      checks: port.value,
    };
    for (const input_digest of [
      f.input.expectedRed.input_digest,
      f.candidate.candidate_id,
    ])
      assert.ok(
        !(
          await executeBrokerTool(context, {
            tool: "checks.run",
            params: { check_id: "unit", input_digest },
          })
        ).ok,
      );
    assert.equal(daemon.calls.length, 0);
    const result = await executeBrokerTool(context, {
      tool: "checks.run",
      params: { check_id: "unit", input_digest: f.input.baseline.input_digest },
    });
    assert.ok(result.ok);
    const output = result.value as { evidence_ref: string };
    const record = checkResultSchema.parse(
      JSON.parse(
        await readFile(
          join(f.options.artifactsDir, `${output.evidence_ref}.json`),
          "utf8",
        ),
      ),
    );
    assert.deepEqual(record.input, {
      phase: "baseline",
      input_digest: f.input.baseline.input_digest,
    });
  } finally {
    await f.cleanup();
  }
});
