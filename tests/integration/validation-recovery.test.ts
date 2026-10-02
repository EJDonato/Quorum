import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runConfiguredCheck } from "../../src/application/run-check.js";
import { exportCheckSnapshot } from "../../src/infrastructure/validation/snapshot.js";
import { validationSandbox } from "../../src/infrastructure/validation/sandbox.js";
import { validationStorage } from "../../src/infrastructure/validation/storage.js";
import { reconcileInterruptedCheck } from "../../src/infrastructure/validation/recovery.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { failure } from "../../src/contracts/errors.js";
import { fakeDocker } from "../fixtures/fake-docker.js";
import { validationFixture, completeReport } from "../fixtures/validation.js";

async function execute(options: {
  fixture: Awaited<ReturnType<typeof validationFixture>>;
  fake: ReturnType<typeof fakeDocker>;
  environment?: Record<string, string>;
  remainingMs?: number;
  recheckedMs?: number;
}) {
  const { fixture, fake } = options;
  let authorizations = 0;
  return runConfiguredCheck({
    config: fixture.config,
    candidate: fixture.candidate,
    checkId: "unit",
    invocationId: "validation-invocation",
    environment: options.environment ?? {},
    ports: {
      digest: canonicalDigest,
      now: () => new Date(),
      authorize: () =>
        Promise.resolve({
          ok: true,
          value: {
            remainingMs:
              ++authorizations === 1
                ? (options.remainingMs ?? 5_000)
                : (options.recheckedMs ?? options.remainingMs ?? 5_000),
          },
        }),
      ...validationStorage(fixture.options.artifactsDir),
      execute: validationSandbox({
        repository: fixture.options.draftDir,
        scratchRoot: fixture.scratchRoot,
        dockerExecutable: "/fake/docker",
        socketPath: "/fake/docker.sock",
        process: fake.process,
      }),
    },
  });
}

await test("uncertain cleanup retains the snapshot, and recovery confirms ownership without replaying the check", async () => {
  const fixture = await validationFixture();
  const uncertain = fakeDocker({ cleanupFailure: true });
  try {
    const result = await execute({
      fixture,
      fake: uncertain,
      recheckedMs: 4_000,
    });
    assert.ok(!result.ok && result.error.code === "CAPABILITY_MISSING");
    const ids = await readdir(fixture.scratchRoot);
    assert.equal(ids.length, 1);
    const executionId = ids[0];
    assert.ok(executionId);
    const recoveryDaemon = fakeDocker(); // No such container: cleanup completed externally.
    const recovered = await reconcileInterruptedCheck({
      artifactsDir: fixture.options.artifactsDir,
      scratchRoot: fixture.scratchRoot,
      executionId,
      dockerExecutable: "/fake/docker",
      socketPath: "/fake/docker.sock",
      process: recoveryDaemon.process,
    });
    assert.ok(recovered.ok && recovered.value.rerunRequired);
    assert.equal(
      recoveryDaemon.calls.some((call) => call.args.includes("start")),
      false,
    );
    assert.deepEqual(await readdir(fixture.scratchRoot), []);
    assert.equal(
      (await readdir(fixture.options.artifactsDir)).includes(
        `${executionId}.json`,
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("recovery rejects changed ownership metadata before accessing the daemon", async () => {
  const fixture = await validationFixture();
  try {
    await execute({ fixture, fake: fakeDocker({ cleanupFailure: true }) });
    const [executionId] = await readdir(fixture.scratchRoot);
    assert.ok(executionId);
    const ownerPath = join(fixture.scratchRoot, executionId, "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as Record<
      string,
      unknown
    >;
    owner["session_id"] = "foreign-session";
    await writeFile(ownerPath, JSON.stringify(owner));
    const daemon = fakeDocker();
    const result = await reconcileInterruptedCheck({
      artifactsDir: fixture.options.artifactsDir,
      scratchRoot: fixture.scratchRoot,
      executionId,
      dockerExecutable: "/fake/docker",
      socketPath: "/fake/docker.sock",
      process: daemon.process,
    });
    assert.ok(!result.ok && result.error.code === "SCOPE_DENIED");
    assert.equal(daemon.calls.length, 0);
    assert.deepEqual(await readdir(fixture.scratchRoot), [executionId]);
  } finally {
    await fixture.cleanup();
  }
});

await test("budget exhaustion, missing report wrappers, and forbidden environment values block before runtime access", async () => {
  const fixture = await validationFixture();
  const fake = fakeDocker();
  try {
    for (const remainingMs of [0, -1, Number.NaN])
      assert.equal((await execute({ fixture, fake, remainingMs })).ok, false);
    fixture.config.permitted_environment_keys = ["API_TOKEN"];
    assert.equal(
      (
        await execute({
          fixture,
          fake,
          environment: { API_TOKEN: "FIXTURE_SECRET" },
        })
      ).ok,
      false,
    );
    delete fixture.config.commands[0]?.report_format;
    assert.equal((await execute({ fixture, fake })).ok, false);
    assert.equal(fake.calls.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

await test("fuzz counts and seeds come from frozen configuration, never a reduced tool claim", async () => {
  const fixture = await validationFixture({
    check_id: "unit",
    kind: "fuzz",
    executable: "node",
    args: ["fuzz.mjs"],
    report_format: "quorum-json-v1",
    fuzz: { seed: 7, cases_required: 500 },
  });
  try {
    for (const fuzz of [
      { seed: 7, cases_required: 1, cases_completed: 1 },
      { seed: 7, cases_required: 500, cases_completed: 499 },
      { seed: 8, cases_required: 500, cases_completed: 500 },
    ]) {
      const fake = fakeDocker({
        stdout: JSON.stringify({ ...completeReport, fuzz }),
      });
      const result = await execute({ fixture, fake });
      assert.ok(result.ok);
      assert.notEqual(result.value.status, "PASSED");
    }
  } finally {
    await fixture.cleanup();
  }
});

await test("failure to persist intent prevents every container side effect", async () => {
  const fixture = await validationFixture();
  let executed = false;
  try {
    const store = validationStorage(fixture.options.artifactsDir);
    const result = await runConfiguredCheck({
      config: fixture.config,
      candidate: fixture.candidate,
      checkId: "unit",
      invocationId: "store-fault",
      environment: {},
      ports: {
        ...store,
        digest: canonicalDigest,
        now: () => new Date(),
        authorize: () =>
          Promise.resolve({ ok: true, value: { remainingMs: 5_000 } }),
        persistIntent: () =>
          Promise.resolve(failure("STORAGE_FAILED", "Injected disk failure")),
        execute: () => {
          executed = true;
          return Promise.resolve(
            failure("STORAGE_FAILED", "Should never execute"),
          );
        },
      },
    });
    assert.ok(!result.ok);
    assert.equal(executed, false);
  } finally {
    await fixture.cleanup();
  }
});

await test("snapshot reads exact tree objects and rejects symlinks, LFS pointers, and a false object format", async () => {
  const fixture = await validationFixture();
  try {
    const dir = join(fixture.rootDir, "export");
    await mkdir(dir);
    const copied = await exportCheckSnapshot({
      repository: fixture.options.draftDir,
      tree: fixture.candidate.identity.tree,
      destination: dir,
    });
    assert.ok(copied.ok);
    await chmod(dir, 0o755);
    await symlink("/etc/passwd", join(fixture.options.draftDir, "escape"));
    fixture.git(fixture.options.draftDir, ["add", "escape"]);
    const linkedTree = fixture.git(fixture.options.draftDir, ["write-tree"]);
    const linkedDir = join(fixture.rootDir, "linked-export");
    await mkdir(linkedDir);
    const linked = await exportCheckSnapshot({
      repository: fixture.options.draftDir,
      tree: { format: "sha1", oid: linkedTree },
      destination: linkedDir,
    });
    assert.ok(!linked.ok && linked.error.code === "SCOPE_DENIED");
    await writeFile(
      join(fixture.options.draftDir, "lfs.txt"),
      "version https://git-lfs.github.com/spec/v1\noid sha256:FIXTURE\n",
    );
    fixture.git(fixture.options.draftDir, ["rm", "--cached", "escape"]);
    fixture.git(fixture.options.draftDir, ["add", "lfs.txt"]);
    const lfsDir = join(fixture.rootDir, "lfs-export");
    await mkdir(lfsDir);
    const lfs = await exportCheckSnapshot({
      repository: fixture.options.draftDir,
      tree: {
        format: "sha1",
        oid: fixture.git(fixture.options.draftDir, ["write-tree"]),
      },
      destination: lfsDir,
    });
    assert.ok(!lfs.ok && lfs.error.code === "CAPABILITY_MISSING");
    const invalid = await exportCheckSnapshot({
      repository: fixture.options.draftDir,
      tree: { format: "sha256", oid: fixture.candidate.identity.tree.oid },
      destination: lfsDir,
    });
    assert.equal(invalid.ok, false);
  } finally {
    await fixture.cleanup();
  }
});
