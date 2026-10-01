import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkSourceWorktreeStatus,
  computeDraftDiff,
  readSourceRepositoryInfo,
  writeDraftTree,
} from "../../src/infrastructure/git/operations.js";
import {
  cleanSessionWorkspace,
  createSessionWorkspace,
  readWorkspaceMeta,
} from "../../src/infrastructure/workspace/manager.js";

async function createFixtureGitRepo(): Promise<{
  repoDir: string;
  headSha: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-source-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Quorum Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@quorum.local"], {
    cwd: dir,
  });

  await writeFile(join(dir, "README.md"), "# Source Repo\nInitial content\n");
  await writeFile(join(dir, "app.ts"), "export const value = 42;\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
  })
    .toString()
    .trim();

  return { repoDir: dir, headSha };
}

await test("source repository inspection reads identity and status accurately", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  try {
    const info = await readSourceRepositoryInfo(repoDir);
    assert.equal(info.ok, true);
    if (info.ok) {
      assert.equal(info.value.headSha, headSha);
      assert.ok(
        info.value.objectFormat === "sha1" ||
          info.value.objectFormat === "sha256",
      );
    }

    const pristineStatus = await checkSourceWorktreeStatus(repoDir);
    assert.equal(pristineStatus.ok, true);
    if (pristineStatus.ok) {
      assert.equal(pristineStatus.value.isPristine, true);
      assert.deepEqual(pristineStatus.value.untracked, []);
    }

    // Add uncommitted changes
    await writeFile(join(repoDir, "uncommitted.txt"), "hello untracked\n");
    await writeFile(join(repoDir, "app.ts"), "export const value = 99;\n");

    const dirtyStatus = await checkSourceWorktreeStatus(repoDir);
    assert.equal(dirtyStatus.ok, true);
    if (dirtyStatus.ok) {
      assert.equal(dirtyStatus.value.isPristine, false);
      assert.deepEqual(dirtyStatus.value.untracked, ["uncommitted.txt"]);
      assert.deepEqual(dirtyStatus.value.unstaged, ["app.ts"]);
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

await test("isolated draft snapshot preserves source repository across draft mutations", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-test-root-"));
  const sessionId = "sess000000000000000000000001";

  try {
    // Add dirty files to source BEFORE creating draft
    await writeFile(join(repoDir, "local-untracked.txt"), "untracked work\n");
    await writeFile(join(repoDir, "app.ts"), "export const value = 100;\n");

    const workspace = await createSessionWorkspace({
      rootDir,
      sessionId,
      sourceDir: repoDir,
      baseSha: headSha,
    });
    assert.equal(workspace.ok, true);
    if (!workspace.ok) return;

    // Verify metadata
    const meta = await readWorkspaceMeta(workspace.value.metaFile);
    assert.equal(meta.ok, true);
    if (meta.ok) {
      assert.equal(meta.value.session_id, sessionId);
      assert.equal(meta.value.base_sha, headSha);
      assert.equal(meta.value.workspace_available, true);
    }

    // Verify draft has committed content from headSha and NOT the dirty uncommitted files
    const draftApp = await readFile(
      join(workspace.value.draftDir, "app.ts"),
      "utf8",
    );
    assert.equal(draftApp, "export const value = 42;\n"); // Committed version!
    await assert.rejects(
      () => readFile(join(workspace.value.draftDir, "local-untracked.txt")),
      /ENOENT/,
    );

    // Mutate draft workspace
    await writeFile(
      join(workspace.value.draftDir, "app.ts"),
      "export const value = 999;\n",
    );
    await writeFile(
      join(workspace.value.draftDir, "draft-new.ts"),
      "export const draftOnly = true;\n",
    );

    // Assert source repository remains COMPLETELY UNTOUCHED
    const srcApp = await readFile(join(repoDir, "app.ts"), "utf8");
    assert.equal(srcApp, "export const value = 100;\n"); // Source retained its exact state
    await assert.rejects(
      () => readFile(join(repoDir, "draft-new.ts")),
      /ENOENT/,
    );

    // Test tree write and diff calculation
    const tree = await writeDraftTree(workspace.value.draftDir);
    assert.equal(tree.ok, true);
    if (tree.ok) {
      assert.match(tree.value.treeOid, /^[0-9a-f]{40,64}$/);
    }

    const diff = await computeDraftDiff({
      draftDir: workspace.value.draftDir,
      baseSha: headSha,
    });
    assert.equal(diff.ok, true);
    if (diff.ok) {
      assert.match(diff.value, /draft-new\.ts/);
      assert.match(diff.value, /999/);
    }

    // Test workspace cleanup safety
    const lockedClean = await cleanSessionWorkspace({
      rootDir,
      sessionId,
      leaseStatus: "ACTIVE",
    });
    assert.equal(lockedClean.ok, false);
    if (!lockedClean.ok) {
      assert.equal(lockedClean.error.code, "LOCKED");
    }

    const clean = await cleanSessionWorkspace({
      rootDir,
      sessionId,
      leaseStatus: "COMPLETED",
    });
    assert.equal(clean.ok, true);
    await assert.rejects(
      () => readFile(join(workspace.value.draftDir, "app.ts")),
      /ENOENT/,
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});
