import { runProcess } from "../../src/infrastructure/process/runner.js";
// Explicit opt-in Linux container fixtures. No model calls, downloads, or live services.
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createValidationCheckPort } from "../../src/infrastructure/validation/composition.js";
import { createCandidateIdentity } from "../../src/application/candidates.js";
import { validationEnvironment } from "../../src/application/run-check.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { checkResultSchema } from "../../src/contracts/checks.js";
import { validationFixture, hash } from "../fixtures/validation.js";

const image = process.env.QUORUM_VALIDATION_IMAGE;
const socketPath = process.env.QUORUM_VALIDATION_SOCKET;
const dockerExecutable = process.env.QUORUM_VALIDATION_DOCKER;
assert.ok(
  image && socketPath && dockerExecutable,
  "Use the explicit test:validation:container command.",
);
const reportScript = `console.log(JSON.stringify({schema_version:'1.0.0',report_complete:true,discovered_tests:1,error_count:0,warning_count:0,failure_class:null,tool_version:process.version,fuzz:null}));`;

async function live(
  script: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    executable?: string;
    cancelOnStart?: AbortController;
  } = {},
) {
  const fixture = await validationFixture(
    {
      check_id: "unit",
      kind: "test",
      report_format: "quorum-json-v1",
      executable: options.executable ?? "node",
      args: ["-e", script],
    },
    options.timeoutMs ?? 30_000,
  );
  fixture.config.validation_image = image ?? "";
  const candidate = createCandidateIdentity(
    {
      ...fixture.candidate.identity,
      configuration_digest: hash(fixture.config),
      validation_environment_digest: hash(
        validationEnvironment(fixture.config, {}),
      ),
    },
    { digest: canonicalDigest },
  );
  assert.ok(candidate.ok);
  const port = createValidationCheckPort({
    config: fixture.config,
    candidate: candidate.value,
    sessionId: fixture.options.sessionId,
    invocationId: "container-fixture",
    checkIds: ["unit"],
    artifactsDir: fixture.options.artifactsDir,
    environment: {},
    authorize: () =>
      Promise.resolve({
        ok: true,
        value: { remainingMs: options.timeoutMs ?? 30_000 },
      }),
    sandbox: {
      repository: fixture.options.draftDir,
      scratchRoot: fixture.scratchRoot,
      socketPath: socketPath ?? "",
      dockerExecutable: dockerExecutable ?? "",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.cancelOnStart
        ? {
            signal: options.cancelOnStart.signal,
            process: async (call) => {
              const timer = call.args.includes("start")
                ? setTimeout(() => options.cancelOnStart?.abort(), 300)
                : null;
              try {
                return await runProcess(call);
              } finally {
                if (timer) clearTimeout(timer);
              }
            },
          }
        : {}),
    },
  });
  assert.ok(port.ok);
  return { ...fixture, run: () => port.value.run("unit") };
}

await test("real container denies candidate writes, host metadata/socket/environment, and external networking", async () => {
  const script = `const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');
    assert.equal(fs.readFileSync('/workspace/app.ts','utf8'),'export const value = 2;\\n');
    assert.throws(()=>fs.writeFileSync('/workspace/app.ts','bypass'));
    assert.throws(()=>fs.writeFileSync('/etc/quorum-bypass','bypass'));
    for(const p of ['/workspace/.git','/host-source','/host-artifacts','/var/run/docker.sock'])assert.equal(fs.existsSync(p),false);
    assert.equal(process.env.HOST_SECRET_FORBIDDEN??'','');
    assert.equal(Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal).length,0);
    fs.writeFileSync('/scratch/fixture','scratch works');assert.equal(fs.readFileSync('/scratch/fixture','utf8'),'scratch works');
    ${reportScript}`;
  const fixture = await live(script);
  const previous = process.env.HOST_SECRET_FORBIDDEN;
  process.env.HOST_SECRET_FORBIDDEN = "QUORUM_HOST_CANARY";
  try {
    // Preserve dirty user state and index as well as committed history.
    await writeFile(join(fixture.options.sourceDir, "app.ts"), "human edits\n");
    await writeFile(
      join(fixture.options.sourceDir, "untracked.txt"),
      "human untracked\n",
    );
    fixture.git(fixture.options.sourceDir, ["add", "app.ts"]);
    const index = await readFile(
      join(fixture.options.sourceDir, ".git", "index"),
    );
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.error));
    if (result.value.status !== "PASSED") {
      const record = await readFile(
        join(fixture.options.artifactsDir, `${result.value.evidence_ref}.json`),
        "utf8",
      );
      const stderr = await readFile(
        join(
          fixture.options.artifactsDir,
          "checks",
          result.value.execution_id,
          "stderr.txt",
        ),
        "utf8",
      );
      assert.fail(`Validation blocked: ${record}\n${stderr}`);
    }
    const record = checkResultSchema.parse(
      JSON.parse(
        await readFile(
          join(
            fixture.options.artifactsDir,
            `${result.value.evidence_ref}.json`,
          ),
          "utf8",
        ),
      ),
    );
    assert.match(record.tool_version, /^v\d+\./);
    assert.deepEqual(
      await readFile(join(fixture.options.sourceDir, ".git", "index")),
      index,
    );
    assert.equal(
      await readFile(join(fixture.options.sourceDir, "app.ts"), "utf8"),
      "human edits\n",
    );
    assert.equal(
      await readFile(join(fixture.options.sourceDir, "untracked.txt"), "utf8"),
      "human untracked\n",
    );
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    if (previous === undefined) delete process.env.HOST_SECRET_FORBIDDEN;
    else process.env.HOST_SECRET_FORBIDDEN = previous;
    await fixture.cleanup();
  }
});

await test("detached descendant stays inside the container and removal is confirmed", async () => {
  const fixture = await live(
    `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();${reportScript}`,
  );
  try {
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.status, "PASSED");
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    await fixture.cleanup();
  }
});

await test("real deadline stops a stubborn process and blocks its partial report", async () => {
  const fixture = await live(
    `${reportScript}process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    { timeoutMs: 5_000 },
  );
  try {
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.status, "BLOCKED");
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    await fixture.cleanup();
  }
});

await test("real output overflow cannot pass even after a valid report", async () => {
  const fixture = await live(
    `${reportScript}process.stdout.write('x'.repeat(2_000_000));setInterval(()=>{},1000);`,
  );
  try {
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.status, "BLOCKED");
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    await fixture.cleanup();
  }
});

await test("missing executable cannot become passing evidence", async () => {
  const fixture = await live(reportScript, {
    executable: "/quorum-missing-tool",
  });
  try {
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.status, "BLOCKED");
    const record = checkResultSchema.parse(
      JSON.parse(
        await readFile(
          join(
            fixture.options.artifactsDir,
            `${result.value.evidence_ref}.json`,
          ),
          "utf8",
        ),
      ),
    );
    assert.equal(record.execution_status, "FAILED");
  } finally {
    await fixture.cleanup();
  }
});

await test("explicit cancellation stops the owned container and makes the report incomplete", async () => {
  const controller = new AbortController();
  const fixture = await live(`${reportScript}setInterval(()=>{},1000);`, {
    cancelOnStart: controller,
  });
  try {
    const result = await fixture.run();
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.status, "BLOCKED");
    const record = checkResultSchema.parse(
      JSON.parse(
        await readFile(
          join(
            fixture.options.artifactsDir,
            `${result.value.evidence_ref}.json`,
          ),
          "utf8",
        ),
      ),
    );
    assert.equal(record.execution_status, "CANCELLED");
    assert.equal(record.report_complete, false);
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
  } finally {
    await fixture.cleanup();
  }
});
