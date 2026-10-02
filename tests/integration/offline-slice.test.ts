import {
  fakeWorkflowVerification,
  fakeStageHooks,
} from "../fixtures/workflow.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSession } from "../../src/application/orchestrator.js";
import { createFakePlan } from "../../src/domain/fake-roles.js";
import {
  checkSourceWorktreeStatus,
  readSourceRepositoryInfo,
} from "../../src/infrastructure/git/operations.js";

async function createFixtureGitRepo(): Promise<{
  repoDir: string;
  headSha: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-offline-source-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Quorum Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@quorum.local"], {
    cwd: dir,
  });

  await writeFile(join(dir, "README.md"), "# Offline Slice Repo\n");
  await writeFile(join(dir, "app.ts"), "export const answer = 41;\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();

  return { repoDir: dir, headSha };
}

await test("offline vertical slice completes end-to-end with matching commit tree", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-offline-root-"));
  const sessionId = "sess000000000000000000000001";

  try {
    const runResult = await runSession({
      rootDir,
      sourceDir: repoDir,
      sessionId,
      baseSha: headSha,
      objectFormat: "sha1",
      verification: fakeWorkflowVerification(),
      commit: true,
      hooks: {
        ...fakeStageHooks(),
        onPlan: async (workspace) => {
          const plan = createFakePlan(sessionId);
          await writeFile(
            join(workspace.workspaceDir, "plan.json"),
            JSON.stringify(plan, null, 2),
          );
          return { ok: true, value: undefined };
        },
        onTestAuthor: async (workspace) => {
          await mkdir(join(workspace.draftDir, "tests"));
          await writeFile(
            join(workspace.draftDir, "tests", "app.test.ts"),
            "import { answer } from '../app';\nassert.equal(answer, 42);\n",
          );
          return { ok: true, value: undefined };
        },
        onImplement: async (workspace) => {
          await writeFile(
            join(workspace.draftDir, "app.ts"),
            "export const answer = 42;\n",
          );
          return { ok: true, value: undefined };
        },
        onValidate: () => Promise.resolve({ ok: true, value: undefined }),
        onReview: () => Promise.resolve({ ok: true, value: undefined }),
      },
    });

    assert.equal(runResult.ok, true);
    if (!runResult.ok) return;

    assert.equal(runResult.value.state.state, "COMPLETED");
    assert.ok(runResult.value.candidateId);
    assert.ok(runResult.value.receipt);

    // Verify commit object on refs/heads/quorum/<sessionId> in isolated draft repo
    const draftDir = join(rootDir, ".quorum", "workspaces", sessionId, "draft");
    const quorumRef = `refs/heads/quorum/${sessionId}`;
    const commitSha = execFileSync("git", ["rev-parse", quorumRef], {
      cwd: draftDir,
    })
      .toString()
      .trim();

    assert.equal(commitSha, runResult.value.receipt.commit.oid);

    // Commit parent must be headSha
    const parentSha = execFileSync(
      "git",
      ["log", "-1", "--format=%P", commitSha],
      { cwd: draftDir },
    )
      .toString()
      .trim();
    assert.equal(parentSha, headSha);

    // Commit tree must equal receipt tree
    const commitTree = execFileSync(
      "git",
      ["log", "-1", "--format=%T", commitSha],
      { cwd: draftDir },
    )
      .toString()
      .trim();
    assert.equal(commitTree, runResult.value.receipt.tree.oid);

    // Source repo must remain strictly pristine (HEAD unchanged, working tree clean)
    const sourceInfo = await readSourceRepositoryInfo(repoDir);
    assert.equal(sourceInfo.ok, true);
    if (sourceInfo.ok) {
      assert.equal(sourceInfo.value.headSha, headSha);
    }

    const sourceStatus = await checkSourceWorktreeStatus(repoDir);
    assert.equal(sourceStatus.ok, true);
    if (sourceStatus.ok) {
      assert.equal(sourceStatus.value.isPristine, true);
      assert.deepEqual(sourceStatus.value.untracked, []);
      assert.deepEqual(sourceStatus.value.unstaged, []);
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});
