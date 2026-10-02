import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSession } from "../../src/application/orchestrator.js";
import { createRunnerOrchestrationHooks } from "../../src/application/runner-dispatch.js";
import { createAgyRunnerAdapter } from "../../src/infrastructure/adapters/agy/adapter.js";
import { createCodexRunnerAdapter } from "../../src/infrastructure/adapters/codex/adapter.js";
import { createFakePlan } from "../../src/domain/fake-roles.js";
import {
  fakeStageHooks,
  fakeWorkflowVerification,
} from "../fixtures/workflow.js";

async function createFixtureRepo(): Promise<{
  repoDir: string;
  headSha: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-concrete-source-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Quorum Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@quorum.local"], {
    cwd: dir,
  });
  await writeFile(join(dir, "README.md"), "# Concrete Adapter Test\n");
  await writeFile(join(dir, "app.ts"), "export const answer = 41;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();
  return { repoDir: dir, headSha };
}

await test("createAgyRunnerAdapter executes workflow session and installs tool gate hooks", async (t) => {
  const { repoDir, headSha } = await createFixtureRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-agy-root-"));
  const sessionId = "sess000000000000000000000010";
  t.after(() => {
    rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
    rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const invocations: string[] = [];
  const adapter = createAgyRunnerAdapter({
    expectedVersion: "1.2.14",
    customInvoke: async (request, _signal, workspace) => {
      invocations.push(
        `${request.assignment.role}:${request.assignment.phase}`,
      );
      const now = new Date().toISOString();
      if (workspace && request.assignment.phase === "planning") {
        const plan = createFakePlan(sessionId);
        await writeFile(
          join(workspace.workspaceDir, "plan.json"),
          JSON.stringify(plan, null, 2),
        );
      } else if (workspace && request.assignment.phase === "test_authoring") {
        await mkdir(join(workspace.draftDir, "tests"), { recursive: true });
        await writeFile(
          join(workspace.draftDir, "tests", "app.test.ts"),
          "assert.equal(42, 42);\n",
        );
      } else if (workspace && request.assignment.phase === "implementation") {
        await writeFile(
          join(workspace.draftDir, "app.ts"),
          "export const answer = 42;\n",
        );
      }
      return {
        ok: true,
        value: {
          protocol_version: "1.0.0",
          invocation_id: request.invocation_id,
          session_id: request.session_id,
          input_digest: request.input_digest,
          execution_status: "SUCCEEDED",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
            charged_tokens: 150,
            accounting_complete: true,
          },
          output_ref: {
            artifact_id: `output-${request.assignment.role}`,
            digest: request.input_digest,
          },
          error: null,
          started_at: now,
          ended_at: now,
        },
      };
    },
  });

  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest: "sha256:" + "b".repeat(64),
    responseSchemaRef: {
      artifact_id: "schema-ref",
      digest: "sha256:" + "b".repeat(64),
    },
  });

  const runResult = await runSession({
    rootDir,
    sourceDir: repoDir,
    sessionId,
    baseSha: headSha,
    objectFormat: "sha1",
    verification: fakeWorkflowVerification(),
    commit: true,
    hooks: { ...fakeStageHooks(), ...hooks },
  });

  assert.equal(runResult.ok, true);
  if (!runResult.ok) return;
  assert.equal(runResult.value.state.state, "COMPLETED");
  assert.ok(runResult.value.receipt);
  assert.deepEqual(invocations, [
    "planner:planning",
    "qa:test_authoring",
    "developer:implementation",
    "qa:final",
  ]);

  const hooksPath = join(
    rootDir,
    ".quorum",
    "workspaces",
    sessionId,
    ".agents",
    "hooks.json",
  );
  const hooksContent = await readFile(hooksPath, "utf-8");
  assert.match(hooksContent, /quorum-broker-gate/);
});

await test("createCodexRunnerAdapter executes workflow session through hooks", async (t) => {
  const { repoDir, headSha } = await createFixtureRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-codex-root-"));
  const sessionId = "sess000000000000000000000011";
  t.after(() => {
    rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
    rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const adapter = createCodexRunnerAdapter({
    expectedVersion: "0.159.3",
    customInvoke: async (request, _signal, workspace) => {
      const now = new Date().toISOString();
      if (workspace && request.assignment.phase === "planning") {
        const plan = createFakePlan(sessionId);
        await writeFile(
          join(workspace.workspaceDir, "plan.json"),
          JSON.stringify(plan, null, 2),
        );
      } else if (workspace && request.assignment.phase === "test_authoring") {
        await mkdir(join(workspace.draftDir, "tests"), { recursive: true });
        await writeFile(
          join(workspace.draftDir, "tests", "app.test.ts"),
          "assert.equal(42, 42);\n",
        );
      } else if (workspace && request.assignment.phase === "implementation") {
        await writeFile(
          join(workspace.draftDir, "app.ts"),
          "export const answer = 42;\n",
        );
      }
      return {
        ok: true,
        value: {
          protocol_version: "1.0.0",
          invocation_id: request.invocation_id,
          session_id: request.session_id,
          input_digest: request.input_digest,
          execution_status: "SUCCEEDED",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
            charged_tokens: 150,
            accounting_complete: true,
          },
          output_ref: {
            artifact_id: `output-${request.assignment.role}`,
            digest: request.input_digest,
          },
          error: null,
          started_at: now,
          ended_at: now,
        },
      };
    },
  });

  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest: "sha256:" + "c".repeat(64),
    responseSchemaRef: {
      artifact_id: "schema-ref",
      digest: "sha256:" + "c".repeat(64),
    },
  });

  const runResult = await runSession({
    rootDir,
    sourceDir: repoDir,
    sessionId,
    baseSha: headSha,
    objectFormat: "sha1",
    verification: fakeWorkflowVerification(),
    commit: true,
    hooks: { ...fakeStageHooks(), ...hooks },
  });

  assert.equal(runResult.ok, true);
  if (!runResult.ok) return;
  assert.equal(runResult.value.state.state, "COMPLETED");
  assert.ok(runResult.value.receipt);
});
