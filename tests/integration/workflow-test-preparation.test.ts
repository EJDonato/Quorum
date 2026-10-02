import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { runSession } from "../../src/application/orchestrator.js";
import {
  fakeWorkflowVerification,
  fakeStageHooks,
} from "../fixtures/workflow.js";
import { failure } from "../../src/contracts/errors.js";
import { readPreparationArtifact } from "../../src/infrastructure/validation/preparation-composition.js";

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-prep-gate-"));
  const sourceDir = join(rootDir, "source");
  await mkdir(sourceDir);
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: sourceDir, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(sourceDir, "app.ts"), "export const value = 1;\n");
  git(["add", "app.ts"]);
  git(["commit", "-qm", "fixture"]);
  return {
    rootDir,
    sourceDir,
    baseSha: git(["rev-parse", "HEAD"]),
    sessionId: "prep-gate",
    objectFormat: "sha1" as const,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
}

await test("a successful author callback cannot enter implementation without host preparation evidence", async () => {
  const f = await fixture();
  try {
    let implemented = false;
    const verification = fakeWorkflowVerification();
    delete verification.testPreparation;
    const result = await runSession({
      ...f,
      verification,
      hooks: {
        ...fakeStageHooks(),
        onImplement: () => {
          implemented = true;
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    });
    assert.ok(!result.ok && result.error.code === "CAPABILITY_MISSING");
    assert.equal(implemented, false);
    assert.deepEqual(await readdir(f.rootDir), ["source"]);
  } finally {
    await f.cleanup();
  }
});

await test("missing checks, forged receipts, and foreign preparation identities stop before implementation", async () => {
  for (const fault of ["missing", "receipt", "identity", "draft"] as const) {
    const f = await fixture();
    try {
      let implemented = false;
      const verification = fakeWorkflowVerification();
      const load = verification.testPreparation;
      assert.ok(load);
      verification.testPreparation = async (workspace) => {
        const data = await load(workspace);
        assert.ok(data.ok);
        if (fault === "missing")
          return failure("CAPABILITY_MISSING", "Missing real checks");
        if (fault === "draft") {
          await writeFile(
            join(workspace.draftDir, "app.ts"),
            "changed after preparation\n",
          );
          return data;
        }
        return {
          ok: true,
          value:
            fault === "receipt"
              ? { ...data.value, receipt: {} }
              : {
                  ...data.value,
                  policy: { ...data.value.policy, sessionId: "foreign" },
                },
        };
      };
      const result = await runSession({
        ...f,
        verification,
        hooks: {
          ...fakeStageHooks(),
          onImplement: () => {
            implemented = true;
            return Promise.resolve({ ok: true, value: undefined });
          },
        },
      });
      assert.ok(!result.ok);
      assert.equal(implemented, false);
    } finally {
      await f.cleanup();
    }
  }
});

await test("preparation artifact resolver rejects role-supplied path escapes", async () => {
  const f = await fixture();
  try {
    assert.ok(
      !(
        await readPreparationArtifact(f.rootDir, {
          artifact_id: "../source/app.ts",
          digest: `sha256:${"f".repeat(64)}`,
        })
      ).ok,
    );
  } finally {
    await f.cleanup();
  }
});
