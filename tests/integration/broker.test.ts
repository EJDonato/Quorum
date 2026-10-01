import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeBrokerTool,
  type BrokerSessionContext,
} from "../../src/broker/broker.js";
import { computeDraftDigest } from "../../src/broker/patch.js";
import { createIsolatedDraft } from "../../src/infrastructure/git/operations.js";

async function setupTestWorkspace(): Promise<{
  workDir: string;
  draftDir: string;
  artifactsDir: string;
  initialDigest: string;
}> {
  const workDir = await mkdtemp(join(tmpdir(), "quorum-test-broker-"));
  const srcDir = join(workDir, "src-repo");
  const draftDir = join(workDir, "draft");
  const artifactsDir = join(workDir, "artifacts");

  execFileSync("git", ["init", "-b", "main", srcDir]);
  execFileSync("git", ["config", "user.name", "Broker Test"], { cwd: srcDir });
  execFileSync("git", ["config", "user.email", "broker@test.local"], {
    cwd: srcDir,
  });

  await writeFile(join(srcDir, "index.ts"), "export const hello = 'world';\n");
  await writeFile(join(srcDir, "protected.json"), '{"secret":true}\n');
  await writeFile(join(srcDir, "test.ts"), "test('example');\n");

  execFileSync("git", ["add", "-A"], { cwd: srcDir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: srcDir });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: srcDir })
    .toString()
    .trim();

  await createIsolatedDraft({ sourceDir: srcDir, draftDir, baseSha: head });
  const digestRes = await computeDraftDigest(draftDir);
  assert.equal(digestRes.ok, true);

  const { mkdir } = await import("node:fs/promises");
  await mkdir(artifactsDir, { recursive: true });

  return {
    workDir,
    draftDir,
    artifactsDir,
    initialDigest: digestRes.ok ? digestRes.value : "",
  };
}

await test("broker repo.read and repo.search operate safely on draft files", async () => {
  const env = await setupTestWorkspace();
  const context: BrokerSessionContext = {
    sessionId: "sess000000000000000000000001",
    invocationId: "inv0000000000000000000000001",
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    draftDir: env.draftDir,
    artifactsDir: env.artifactsDir,
    grantedPaths: ["."],
    protectedPaths: ["protected.json"],
  };

  try {
    // Read file
    const read = await executeBrokerTool(context, {
      tool: "repo.read",
      params: { path: "index.ts" },
    });
    assert.equal(read.ok, true);
    if (read.ok) {
      const val = read.value as { content: string; digest: string };
      assert.match(val.content, /hello = 'world'/);
      assert.match(val.digest, /^sha256:[0-9a-f]{64}$/);
    }

    // Attempt traversal read
    const traversalRead = await executeBrokerTool(context, {
      tool: "repo.read",
      params: { path: "../outside.txt" },
    });
    assert.equal(traversalRead.ok, false);
    if (!traversalRead.ok) {
      assert.equal(traversalRead.error.code, "SCOPE_DENIED");
    }

    // Search files
    const search = await executeBrokerTool(context, {
      tool: "repo.search",
      params: { query: "hello" },
    });
    assert.equal(search.ok, true);
    if (search.ok) {
      const val = search.value as {
        matches: Array<{ path: string; line: number; text: string }>;
      };
      assert.equal(val.matches.length, 1);
      assert.equal(val.matches[0]?.path, "index.ts");
    }
  } finally {
    await rm(env.workDir, { recursive: true, force: true });
  }
});

await test("broker draft.apply_patch enforces permissions, digest freshness, and path protections", async () => {
  const env = await setupTestWorkspace();
  const devContext: BrokerSessionContext = {
    sessionId: "sess000000000000000000000001",
    invocationId: "inv0000000000000000000000001",
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    draftDir: env.draftDir,
    artifactsDir: env.artifactsDir,
    grantedPaths: ["index.ts", "feature.ts"],
    protectedPaths: ["protected.json", "test.ts"],
  };

  try {
    const validPatch = `--- a/index.ts
+++ b/index.ts
@@ -1 +1,2 @@
 export const hello = 'world';
+export const added = 123;
`;

    // 1. Success case
    const applied = await executeBrokerTool(devContext, {
      tool: "draft.apply_patch",
      params: {
        expected_draft_digest: env.initialDigest,
        patch: validPatch,
      },
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;

    const appliedVal = applied.value as {
      draft_digest: string;
      changed_paths: string[];
    };
    assert.notEqual(appliedVal.draft_digest, env.initialDigest);
    assert.deepEqual(appliedVal.changed_paths, ["index.ts"]);

    // 2. Stale input rejection (re-applying with original initialDigest)
    const stale = await executeBrokerTool(devContext, {
      tool: "draft.apply_patch",
      params: {
        expected_draft_digest: env.initialDigest,
        patch: validPatch,
      },
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.error.code, "STALE_INPUT");
    }

    // 3. Protected path rejection (developer trying to edit test.ts or protected.json)
    const protectedPatch = `--- a/protected.json
+++ b/protected.json
@@ -1 +1 @@
-{"secret":true}
+{"secret":false}
`;
    const deniedProtected = await executeBrokerTool(devContext, {
      tool: "draft.apply_patch",
      params: {
        expected_draft_digest: appliedVal.draft_digest,
        patch: protectedPatch,
      },
    });
    assert.equal(deniedProtected.ok, false);
    if (!deniedProtected.ok) {
      assert.equal(deniedProtected.error.code, "SCOPE_DENIED");
    }

    // 4. Role authorization: QA in final review cannot patch
    const qaReviewContext: BrokerSessionContext = {
      ...devContext,
      role: "QA",
      phase: "REVIEWING",
    };
    const deniedRole = await executeBrokerTool(qaReviewContext, {
      tool: "draft.apply_patch",
      params: {
        expected_draft_digest: appliedVal.draft_digest,
        patch: validPatch,
      },
    });
    assert.equal(deniedRole.ok, false);
    if (!deniedRole.ok) {
      assert.equal(deniedRole.error.code, "SCOPE_DENIED");
    }
  } finally {
    await rm(env.workDir, { recursive: true, force: true });
  }
});

await test("broker role.submit, scope.request, checks.run, and artifact.read execute cleanly", async () => {
  const env = await setupTestWorkspace();
  const context: BrokerSessionContext = {
    sessionId: "sess000000000000000000000001",
    invocationId: "inv0000000000000000000000001",
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    draftDir: env.draftDir,
    artifactsDir: env.artifactsDir,
    grantedPaths: ["."],
    protectedPaths: [],
  };

  try {
    // 1. role.submit
    const submit = await executeBrokerTool(context, {
      tool: "role.submit",
      params: {
        body: { explanation: "implementation complete", files: ["index.ts"] },
      },
    });
    assert.equal(submit.ok, true);
    if (!submit.ok) return;
    const { result_ref } = submit.value as { result_ref: string };

    // 2. artifact.read
    const readArtifact = await executeBrokerTool(context, {
      tool: "artifact.read",
      params: { artifact_id: result_ref },
    });
    assert.equal(readArtifact.ok, true);
    if (readArtifact.ok) {
      const artVal = readArtifact.value as {
        payload: { body: { explanation: string } };
      };
      assert.equal(artVal.payload.body.explanation, "implementation complete");
    }

    // 3. scope.request
    const scope = await executeBrokerTool(context, {
      tool: "scope.request",
      params: { paths: ["extra/file.ts"], reason: "needed for dependency" },
    });
    assert.equal(scope.ok, true);
    if (scope.ok) {
      const scopeVal = scope.value as { request_ref: string; status: string };
      assert.equal(scopeVal.status, "SUBMITTED");
    }

    // 4. checks.run
    const check = await executeBrokerTool(context, {
      tool: "checks.run",
      params: {
        check_id: "chk0000000000000000000000001",
        input_digest: env.initialDigest,
      },
    });
    assert.equal(check.ok, true);
    if (check.ok) {
      const checkVal = check.value as { status: string; evidence_ref: string };
      assert.equal(checkVal.status, "PASSED");
    }
  } finally {
    await rm(env.workDir, { recursive: true, force: true });
  }
});
