import { mkdirSync, unlinkSync } from "node:fs";
import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRepoFile, searchRepoFiles } from "../../src/broker/repo-tools.js";
import { cleanSessionWorkspace } from "../../src/infrastructure/workspace/manager.js";
import {
  acquireSessionLease,
  updateSessionLeaseStatus,
} from "../../src/infrastructure/storage/locks.js";
import {
  readArtifact,
  writeArtifact,
} from "../../src/infrastructure/storage/artifacts.js";
import {
  loadOrReconstructState,
  recordSessionTransition,
} from "../../src/application/session-control.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { initialSession } from "../fixtures/session.js";
import { finalizationFixture } from "../fixtures/finalization.js";

await test("reads and searches enforce grants, literal paths, reserved metadata and symlink denial", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-read-scope-"));
  const context = {
    role: "DEVELOPER" as const,
    phase: "IMPLEMENTING" as const,
    grantedPaths: ["allowed"],
    protectedPaths: ["allowed/test.ts"],
  };
  try {
    await mkdir(join(dir, "allowed"));
    await writeFile(join(dir, "allowed", "test.ts"), "needle\n");
    await writeFile(join(dir, "outside.ts"), "needle secret\n");
    const read = (path: string) =>
      readRepoFile({ draftDir: dir, context, input: { path } });
    assert.ok((await read("allowed/test.ts")).ok); // protected writes can still be read
    for (const path of [
      "outside.ts",
      ".git/config",
      "../outside.ts",
      "allowed-sibling/test.ts",
    ])
      assert.equal((await read(path)).ok, false);
    const search = await searchRepoFiles({
      draftDir: dir,
      context,
      input: { query: "needle" },
    });
    assert.ok(search.ok);
    assert.deepEqual(
      search.value.matches.map((match) => match.path),
      ["allowed/test.ts"],
    );
    for (const scope of [".", "outside.ts", ":(glob)**", "../"])
      assert.equal(
        (
          await searchRepoFiles({
            draftDir: dir,
            context,
            input: { query: "needle", paths: [scope] },
          })
        ).ok,
        false,
      );
    await symlink(join(dir, "outside.ts"), join(dir, "allowed", "link.ts"));
    assert.equal((await read("allowed/link.ts")).ok, false);
    assert.equal(
      (
        await searchRepoFiles({
          draftDir: dir,
          context,
          input: { query: "needle" },
        })
      ).ok,
      false,
    );
    await symlink(dir, join(dir, "allowed", "directory"));
    assert.equal((await read("allowed/directory/outside.ts")).ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("cleanup uses the actual lease even when the caller claims completion", async () => {
  const fixture = await finalizationFixture();
  const { sessionId } = fixture.options;
  const leasePath = join(fixture.rootDir, ".quorum", "lease.json");
  try {
    assert.ok((await acquireSessionLease(leasePath, sessionId)).ok);
    const blocked = await cleanSessionWorkspace({
      rootDir: fixture.rootDir,
      sessionId,
      leaseStatus: "COMPLETED",
    });
    assert.ok(!blocked.ok && blocked.error.code === "LOCKED");
    assert.ok(
      (await readFile(join(fixture.options.draftDir, "app.ts"))).length,
    );
    assert.ok(
      (await updateSessionLeaseStatus(leasePath, sessionId, "COMPLETED")).ok,
    );
    assert.ok(
      (await cleanSessionWorkspace({ rootDir: fixture.rootDir, sessionId })).ok,
    );
    assert.equal(
      await readFile(join(fixture.options.sourceDir, "app.ts"), "utf8"),
      "export const value = 1;\n",
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("cleanup rejects forged ownership, traversal, and linked draft paths", async () => {
  const fixture = await finalizationFixture();
  const { sessionId, artifactsDir, draftDir, sourceDir } = fixture.options;
  const metaPath = join(artifactsDir, "meta", "workspace.json");
  try {
    const original = await readFile(metaPath, "utf8");
    await unlink(metaPath);
    await writeFile(metaPath, original.replace(sessionId, "foreign-session"));
    assert.equal(
      (await cleanSessionWorkspace({ rootDir: fixture.rootDir, sessionId })).ok,
      false,
    );
    await writeFile(metaPath, original);
    assert.equal(
      (
        await cleanSessionWorkspace({
          rootDir: fixture.rootDir,
          sessionId: "../../source",
        })
      ).ok,
      false,
    );
    await rm(draftDir, { recursive: true });
    await symlink(sourceDir, draftDir);
    assert.equal(
      (await cleanSessionWorkspace({ rootDir: fixture.rootDir, sessionId })).ok,
      false,
    );
    assert.equal(
      await readFile(join(sourceDir, "app.ts"), "utf8"),
      "export const value = 1;\n",
    );
  } finally {
    await fixture.cleanup();
  }
});

await test("immutable artifacts permit identical retries and reject substitutions or linked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-immutable-"));
  try {
    const options = {
      baseDir: dir,
      relativePath: "record.json",
      content: "first",
    };
    assert.ok((await writeArtifact(options)).ok);
    assert.ok((await writeArtifact(options)).ok);
    assert.equal(
      (await writeArtifact({ ...options, content: "replacement" })).ok,
      false,
    );
    const read = await readArtifact(options);
    assert.ok(read.ok);
    assert.equal(read.value.content.toString(), "first");
    await symlink(dir, join(dir, "link"));
    assert.equal(
      (await writeArtifact({ ...options, relativePath: "link/escaped.json" }))
        .ok,
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("journal overrides valid stale projections and safely appends after torn tails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-stale-cache-"));
  const initial = initialSession();
  const options = {
    sessionDir: dir,
    initial,
    ports: { digest: canonicalDigest },
  };
  try {
    assert.ok(
      (
        await recordSessionTransition({
          ...options,
          payload: { type: "PREFLIGHT_COMPLETED" },
        })
      ).ok,
    );
    await writeFile(join(dir, "state.json"), JSON.stringify(initial));
    const loaded = await loadOrReconstructState(options);
    assert.ok(loaded.ok);
    assert.equal(loaded.value.state_sequence, 1);
    await appendFile(join(dir, "events.jsonl"), '{"torn":');
    const next = await recordSessionTransition({
      ...options,
      payload: { type: "PLAN_ACCEPTED", design_required: false },
    });
    assert.ok(next.ok);
    const replay = await loadOrReconstructState(options);
    assert.ok(replay.ok);
    assert.equal(replay.value.state_sequence, 2);
    await appendFile(join(dir, "events.jsonl"), '{"corrupt_complete":true}\n');
    const corrupt = await loadOrReconstructState(options);
    assert.ok(!corrupt.ok && corrupt.error.code === "EVIDENCE_INVALID");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("projection failure stops work while the journal preserves the durable transition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-projection-fault-"));
  const options = {
    sessionDir: dir,
    initial: initialSession(),
    ports: { digest: canonicalDigest },
  };
  try {
    const ports = {
      digest: canonicalDigest,
      now: () => {
        unlinkSync(join(dir, "state.json"));
        mkdirSync(join(dir, "state.json"));
        return new Date("2026-10-01T00:00:00Z");
      },
    };
    const result = await recordSessionTransition({
      ...options,
      ports,
      payload: { type: "PREFLIGHT_COMPLETED" },
    });
    assert.ok(!result.ok && result.error.code === "STORAGE_FAILED");
    await rm(join(dir, "state.json"), { recursive: true });
    const recovered = await loadOrReconstructState(options);
    assert.ok(recovered.ok);
    assert.equal(recovered.value.state_sequence, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
