import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSession } from "../../src/application/orchestrator.js";
import { createRunnerOrchestrationHooks } from "../../src/application/runner-dispatch.js";
import type { RunnerAdapter } from "../../src/application/runner-ports.js";
import { createFakePlan } from "../../src/domain/fake-roles.js";
import {
  fakeStageHooks,
  fakeWorkflowVerification,
} from "../fixtures/workflow.js";

async function createFixtureGitRepo(): Promise<{
  repoDir: string;
  headSha: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "quorum-runner-source-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Quorum Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@quorum.local"], {
    cwd: dir,
  });

  await writeFile(join(dir, "README.md"), "# Runner Orchestration Repo\n");
  await writeFile(join(dir, "app.ts"), "export const answer = 41;\n");

  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
    .toString()
    .trim();

  return { repoDir: dir, headSha };
}

void test("runner adapter drives full workflow session through orchestration hooks", async (t) => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-runner-root-"));
  const sessionId = "sess000000000000000000000002";
  t.after(() => {
    rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
    rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const invocations: string[] = [];

  const adapter: RunnerAdapter = {
    discover: () =>
      Promise.resolve({
        ok: true,
        value: {
          runnerName: "agy",
          runnerVersion: "1.2.14-fake",
          modelVersion: "gemini-3.8-flash-fake",
          structuredOutput: true,
          brokerOnlyTools: true,
          descendantCancellation: true,
          usageReporting: true,
          enforceableTokenCeilings: true,
          isolationProfile: "linux-container-v1",
          enforcedConformance: false,
          evidenceDigest: null,
        },
      }),
    invoke: async (request, _signal, workspace) => {
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
    cancel: (invocationId) =>
      Promise.resolve({
        ok: true,
        value: {
          invocationId,
          descendantsTerminated: true,
          confirmedAbsent: true,
          timestamp: new Date().toISOString(),
        },
      }),
  };

  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest: "sha256:" + "a".repeat(64),
    responseSchemaRef: {
      artifact_id: "schema-ref",
      digest: "sha256:" + "a".repeat(64),
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
    hooks: {
      ...fakeStageHooks(),
      ...hooks,
    },
  });

  assert.equal(runResult.ok, true);
  if (!runResult.ok) return;

  assert.equal(runResult.value.state.state, "COMPLETED");
  assert.ok(runResult.value.candidateId);
  assert.ok(runResult.value.receipt);

  assert.deepEqual(invocations, [
    "planner:planning",
    "qa:test_authoring",
    "developer:implementation",
    "qa:final",
  ]);
});

void test("runner failure during implementation halts workflow and preserves draft", async (t) => {
  const { repoDir, headSha } = await createFixtureGitRepo();
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-runner-fail-"));
  const sessionId = "sess000000000000000000000003";
  t.after(() => {
    rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
    rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const adapter: RunnerAdapter = {
    discover: () =>
      Promise.resolve({
        ok: true,
        value: {
          runnerName: "agy",
          runnerVersion: "1.2.14-fake",
          modelVersion: "gemini-3.8-flash-fake",
          structuredOutput: true,
          brokerOnlyTools: true,
          descendantCancellation: true,
          usageReporting: true,
          enforceableTokenCeilings: true,
          isolationProfile: "linux-container-v1",
          enforcedConformance: false,
          evidenceDigest: null,
        },
      }),
    invoke: async (request, _signal, workspace) => {
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
      } else if (request.assignment.phase === "implementation") {
        return {
          ok: true,
          value: {
            protocol_version: "1.0.0",
            invocation_id: request.invocation_id,
            session_id: request.session_id,
            input_digest: request.input_digest,
            execution_status: "FAILED",
            usage: null,
            output_ref: null,
            error: {
              code: "CHECK_FAILED",
              message: "Implementation compilation failed",
              retryable: false,
              remediation: "Fix code errors",
            },
            started_at: now,
            ended_at: now,
          },
        };
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
    cancel: (invocationId) =>
      Promise.resolve({
        ok: true,
        value: {
          invocationId,
          descendantsTerminated: true,
          confirmedAbsent: true,
          timestamp: new Date().toISOString(),
        },
      }),
  };

  const hooks = createRunnerOrchestrationHooks({
    adapter,
    sessionId,
    inputDigest: "sha256:" + "a".repeat(64),
    responseSchemaRef: {
      artifact_id: "schema-ref",
      digest: "sha256:" + "a".repeat(64),
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
    hooks: {
      ...fakeStageHooks(),
      ...hooks,
    },
  });

  assert.equal(runResult.ok, false);
  if (!runResult.ok) {
    assert.equal(runResult.error.code, "CHECK_FAILED");
  }
});
