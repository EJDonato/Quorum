import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeSession } from "../../src/application/finalize.js";
import { runSession } from "../../src/application/orchestrator.js";
import { failure } from "../../src/contracts/errors.js";

async function createFixtureGitRepo(): Promise<{
  repoDir: string;
  headSha: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-recovery-source-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Quorum Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@quorum.local"], {
    cwd: dir,
  });

  await writeFile(join(dir, "README.md"), "# Recovery Repo\n");
  await writeFile(join(dir, "app.ts"), "export const value = 1;\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();

  return { repoDir: dir, headSha };
}

await test("review rejection routes to repair stage and succeeds on retry", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-repair-root-"));
  const sessionId = "sess000000000000000000000002";

  let reviewAttempts = 0;
  let implementAttempts = 0;

  try {
    const runResult = await runSession({
      rootDir,
      sourceDir: repoDir,
      sessionId,
      baseSha: headSha,
      objectFormat: "sha1",
      hooks: {
        onImplement: () => {
          implementAttempts += 1;
          return Promise.resolve({ ok: true, value: undefined });
        },
        onReview: () => {
          reviewAttempts += 1;
          if (reviewAttempts === 1) {
            return Promise.resolve(
              failure("REVIEW_REJECTED", "First attempt rejected by QA."),
            );
          }
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    });

    assert.equal(runResult.ok, true);
    if (!runResult.ok) return;

    assert.equal(runResult.value.state.state, "COMPLETED");
    assert.equal(implementAttempts, 2);
    assert.equal(reviewAttempts, 2);
    assert.equal(runResult.value.state.budget.repairs_by_stage.IMPLEMENTING, 1);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("exhausted repair budget blocks the session", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-exhaust-root-"));
  const sessionId = "sess000000000000000000000003";

  try {
    const runResult = await runSession({
      rootDir,
      sourceDir: repoDir,
      sessionId,
      baseSha: headSha,
      objectFormat: "sha1",
      hooks: {
        onReview: () =>
          Promise.resolve(failure("REVIEW_REJECTED", "Continuous QA failure")),
      },
    });

    assert.equal(runResult.ok, false);
    if (!runResult.ok) {
      assert.equal(runResult.error.code, "BUDGET_EXHAUSTED");
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("source divergence detected before finalization blocks completion", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-diverge-root-"));
  const sessionId = "sess000000000000000000000004";

  try {
    const runResult = await runSession({
      rootDir,
      sourceDir: repoDir,
      sessionId,
      baseSha: headSha,
      objectFormat: "sha1",
      hooks: {
        onReview: async () => {
          // External change to source repo HEAD while session is in flight
          await writeFile(
            join(repoDir, "app.ts"),
            "export const value = 99;\n",
          );
          execFileSync("git", ["add", "-A"], { cwd: repoDir });
          execFileSync("git", ["commit", "-m", "Divergent external commit"], {
            cwd: repoDir,
          });
          return { ok: true, value: undefined };
        },
      },
    });

    assert.equal(runResult.ok, false);
    if (!runResult.ok) {
      assert.equal(runResult.error.code, "SOURCE_DIVERGED");
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});

await test("finalization recovers identical receipt without duplicate commit", async () => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-crash-root-"));
  const sessionId = "sess000000000000000000000005";

  try {
    // First run session to freeze a candidate and complete
    const runResult = await runSession({
      rootDir,
      sourceDir: repoDir,
      sessionId,
      baseSha: headSha,
      objectFormat: "sha1",
      hooks: {},
    });

    assert.equal(runResult.ok, true);
    if (!runResult.ok) return;

    const firstReceipt = runResult.value.receipt;
    const candidateId = runResult.value.candidateId;
    assert.ok(firstReceipt);
    assert.ok(candidateId);

    // Call finalizeSession again with same intent
    const workspaceDir = join(rootDir, ".quorum", "workspaces", sessionId);
    const draftDir = join(workspaceDir, "draft");

    const recoveryResult = await finalizeSession({
      sessionId,
      sourceDir: repoDir,
      draftDir,
      artifactsDir: workspaceDir,
      candidateId,
      treeOid: firstReceipt.tree.oid,
      baseSha: headSha,
      objectFormat: "sha1",
      evidenceRefs: firstReceipt.evidence_refs,
    });

    assert.equal(recoveryResult.ok, true);
    if (!recoveryResult.ok) return;

    // Must return the exact same receipt and commit OID
    assert.equal(
      recoveryResult.value.receipt.commit.oid,
      firstReceipt.commit.oid,
    );
    assert.equal(
      recoveryResult.value.receipt.transaction_id,
      firstReceipt.transaction_id,
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  }
});
