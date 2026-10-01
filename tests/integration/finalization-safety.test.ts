import { sessionStateSchema } from "../../src/contracts/session.js";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { finalizeSession } from "../../src/application/finalize.js";
import { runSession } from "../../src/application/orchestrator.js";
import { failure } from "../../src/contracts/errors.js";
import { finalizationFixture } from "../fixtures/finalization.js";
import {
  fakeStageHooks,
  fakeWorkflowVerification,
} from "../fixtures/workflow.js";

await test("workflow blocks absent host verification and each missing mandatory stage before effects", async () => {
  const fixture = await finalizationFixture();
  try {
    const options = fixture.options;
    const base = {
      rootDir: join(fixture.rootDir, "unused"),
      sourceDir: options.sourceDir,
      sessionId: options.sessionId,
      baseSha: options.baseSha,
      objectFormat: options.objectFormat,
    };
    const missing = await runSession({ ...base, hooks: fakeStageHooks() });
    assert.ok(!missing.ok && missing.error.code === "CAPABILITY_MISSING");
    for (const key of Object.keys(fakeStageHooks()) as Array<
      keyof ReturnType<typeof fakeStageHooks>
    >) {
      const hooks = { ...fakeStageHooks() };
      const omitted = Object.fromEntries(
        Object.entries(hooks).filter(([name]) => name !== key),
      );
      const result = await runSession({
        ...base,
        hooks: omitted,
        verification: fakeWorkflowVerification(),
      });
      assert.ok(!result.ok && result.error.code === "CAPABILITY_MISSING");
    }
    await assert.rejects(
      readFile(join(base.rootDir, ".quorum", "lease.json")),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

for (const stage of ["intent", "object", "ref"] as const) {
  await test(`restart after ${stage} preserves transaction metadata and creates one identical commit`, async () => {
    const fixture = await finalizationFixture();
    try {
      const interrupted = await finalizeSession({
        ...fixture.options,
        now: new Date("2026-10-01T00:00:00Z"),
        checkpoint: (current) =>
          Promise.resolve(
            current === stage
              ? failure("STORAGE_FAILED", "Injected crash")
              : { ok: true, value: undefined },
          ),
      });
      assert.ok(!interrupted.ok);
      const intentBefore = await readFile(
        join(fixture.options.artifactsDir, "finalization.json"),
        "utf8",
      );
      const resumed = await finalizeSession({
        ...fixture.options,
        now: new Date("2026-10-02T00:00:00Z"),
      });
      assert.ok(resumed.ok && resumed.value.recovered);
      assert.equal(
        await readFile(
          join(fixture.options.artifactsDir, "finalization.json"),
          "utf8",
        ),
        intentBefore,
      );
      const repeated = await finalizeSession(fixture.options);
      assert.ok(repeated.ok);
      assert.deepEqual(repeated.value.receipt, resumed.value.receipt);
      const objects = fixture
        .git(fixture.options.draftDir, [
          "cat-file",
          "--batch-all-objects",
          "--batch-check=%(objecttype)",
        ])
        .split("\n");
      assert.equal(objects.filter((type) => type === "commit").length, 2); // base plus one finalized commit
      assert.equal(
        fixture.git(fixture.options.sourceDir, ["rev-parse", "HEAD"]),
        fixture.options.baseSha,
      );
    } finally {
      await fixture.cleanup();
    }
  });
}

await test("finalization blocks absent verifier, advisory mode, missing reviewers, stale identity, and fake refs", async () => {
  const fixture = await finalizationFixture();
  try {
    const opts = fixture.options;
    const missingOptions = { ...opts };
    delete missingOptions.verification;
    const missing = await finalizeSession(missingOptions);
    assert.ok(!missing.ok && missing.error.code === "CAPABILITY_MISSING");
    const staleOnly = { ...opts };
    delete staleOnly.loadSession;
    const noCurrentState = await finalizeSession(staleOnly);
    assert.ok(
      !noCurrentState.ok && noCurrentState.error.code === "CAPABILITY_MISSING",
    );
    const verification = opts.verification;
    assert.ok(verification);
    for (const patch of [
      {
        loadSession: () =>
          Promise.resolve({
            ok: true as const,
            value: sessionStateSchema.parse({
              ...(verification.session as object),
              state: "REVIEWING",
              mode: "advisory",
            }),
          }),
        verification: {
          ...verification,
          session: { ...(verification.session as object), mode: "advisory" },
        },
      },
      { verification: { ...verification, evidenceRefs: [] } },
      { sessionId: "foreign-session" },
      { treeOid: "0".repeat(40) },
      { evidenceRefs: [{ artifact_id: "forged", digest: opts.candidateId }] },
    ])
      assert.equal((await finalizeSession({ ...opts, ...patch })).ok, false);
    await assert.rejects(
      readFile(join(opts.artifactsDir, "finalization.json")),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("mutating evidence during finalization blocks branch creation on recomputation", async () => {
  const fixture = await finalizationFixture();
  try {
    const verification = fixture.options.verification;
    assert.ok(verification);
    const original = verification.ports.readArtifact;
    const result = await finalizeSession({
      ...fixture.options,
      checkpoint: (stage) => {
        if (stage === "object")
          verification.ports.readArtifact = () =>
            Promise.resolve(failure("EVIDENCE_INVALID", "Changed evidence"));
        return Promise.resolve({ ok: true, value: undefined });
      },
    });
    verification.ports.readArtifact = original;
    assert.ok(!result.ok && result.error.code === "EVIDENCE_INVALID");
    assert.throws(() =>
      fixture.git(fixture.options.draftDir, [
        "rev-parse",
        `refs/heads/quorum/${fixture.options.sessionId}`,
      ]),
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("post-approval draft mutations block before commit construction", async () => {
  const fixture = await finalizationFixture();
  try {
    await writeFile(
      join(fixture.options.draftDir, "app.ts"),
      "unreviewed change\n",
    );
    const result = await finalizeSession(fixture.options);
    assert.ok(!result.ok && result.error.code === "STALE_INPUT");
    await assert.rejects(
      readFile(join(fixture.options.artifactsDir, "finalization.json")),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("conflicting branch is preserved and corrupted receipt or intent blocks recovery", async () => {
  const fixture = await finalizationFixture();
  try {
    const opts = fixture.options;
    const ref = `refs/heads/quorum/${opts.sessionId}`;
    fixture.git(opts.draftDir, ["update-ref", ref, opts.baseSha]);
    const conflict = await finalizeSession(opts);
    assert.ok(!conflict.ok && conflict.error.code === "EVIDENCE_INVALID");
    assert.equal(fixture.git(opts.draftDir, ["rev-parse", ref]), opts.baseSha);
    fixture.git(opts.draftDir, ["update-ref", "-d", ref, opts.baseSha]);
    const first = await finalizeSession(opts);
    assert.ok(first.ok);
    await unlink(join(opts.artifactsDir, "receipt.json"));
    await writeFile(join(opts.artifactsDir, "receipt.json"), "{corrupt");
    assert.equal((await finalizeSession(opts)).ok, false);
    await unlink(join(opts.artifactsDir, "receipt.json"));
    await unlink(join(opts.artifactsDir, "finalization.json"));
    await writeFile(join(opts.artifactsDir, "finalization.json"), "{corrupt");
    assert.equal((await finalizeSession(opts)).ok, false);
  } finally {
    await fixture.cleanup();
  }
});

await test("a saved receipt cannot authorize a missing branch or a substituted parent", async () => {
  const fixture = await finalizationFixture();
  try {
    const first = await finalizeSession(fixture.options);
    assert.ok(first.ok);
    fixture.git(fixture.options.draftDir, [
      "update-ref",
      "-d",
      `refs/heads/quorum/${fixture.options.sessionId}`,
      first.value.receipt.commit.oid,
    ]);
    assert.equal((await finalizeSession(fixture.options)).ok, false);
    fixture.git(fixture.options.draftDir, [
      "update-ref",
      `refs/heads/quorum/${fixture.options.sessionId}`,
      first.value.receipt.commit.oid,
    ]);
    const path = join(fixture.options.artifactsDir, "receipt.json");
    await unlink(path);
    await writeFile(
      path,
      JSON.stringify({
        ...first.value.receipt,
        parent: { format: "sha1", oid: "e".repeat(40) },
      }),
    );
    assert.equal((await finalizeSession(fixture.options)).ok, false);
  } finally {
    await fixture.cleanup();
  }
});

await test("source divergence after branch installation blocks receipt publication", async () => {
  const fixture = await finalizationFixture();
  try {
    const result = await finalizeSession({
      ...fixture.options,
      checkpoint: async (stage) => {
        if (stage === "ref") {
          await writeFile(
            join(fixture.options.sourceDir, "app.ts"),
            "external edit\n",
          );
          fixture.git(fixture.options.sourceDir, ["add", "app.ts"]);
          fixture.git(fixture.options.sourceDir, ["commit", "-m", "external"]);
        }
        return { ok: true, value: undefined };
      },
    });
    assert.ok(!result.ok && result.error.code === "SOURCE_DIVERGED");
    await assert.rejects(
      readFile(join(fixture.options.artifactsDir, "receipt.json")),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("workflow stops at approved without explicit commit authorization", async () => {
  const fixture = await finalizationFixture();
  try {
    const options = fixture.options;
    const run = await runSession({
      rootDir: fixture.rootDir,
      sourceDir: options.sourceDir,
      sessionId: "approval-only-fixture",
      baseSha: options.baseSha,
      objectFormat: options.objectFormat,
      hooks: fakeStageHooks(),
      verification: fakeWorkflowVerification(),
    });
    assert.ok(run.ok);
    assert.equal(run.value.state.state, "APPROVED");
    assert.equal(run.value.receipt, undefined);
    const draftDir = join(
      fixture.rootDir,
      ".quorum",
      "workspaces",
      "approval-only-fixture",
      "draft",
    );
    assert.throws(() =>
      fixture.git(draftDir, [
        "rev-parse",
        "refs/heads/quorum/approval-only-fixture",
      ]),
    );
  } finally {
    await fixture.cleanup();
  }
});
