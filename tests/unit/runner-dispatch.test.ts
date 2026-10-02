import assert from "node:assert/strict";
import test from "node:test";
import { createRunnerOrchestrationHooks } from "../../src/application/runner-dispatch.js";
import { createFakeRunnerAdapter } from "../fixtures/fake-runner.js";

const fakeWorkspace = {
  workspaceDir: "/fake/workspace",
  draftDir: "/fake/draft",
  metaDir: "/fake/meta",
  metaFile: "/fake/meta/meta.json",
};

const defaultOptions = {
  sessionId: "session0000000000000000000001",
  inputDigest: "sha256:" + "a".repeat(64),
  responseSchemaRef: {
    artifact_id: "schema-ref",
    digest: "sha256:" + "a".repeat(64),
  },
};

void test("createRunnerOrchestrationHooks executes successful stages through runner adapter", async () => {
  const adapter = createFakeRunnerAdapter();
  const stages: Array<{ stage: string; status: string; durationMs: number }> =
    [];
  const hooks = createRunnerOrchestrationHooks({
    ...defaultOptions,
    adapter,
    onStage: (event) => stages.push(event),
  });

  assert.ok(hooks.onPlan);
  assert.ok(hooks.onTestAuthor);
  assert.ok(hooks.onImplement);
  assert.ok(hooks.onReview);

  const planResult = await hooks.onPlan(fakeWorkspace);
  assert.equal(planResult.ok, true);

  const testResult = await hooks.onTestAuthor(fakeWorkspace);
  assert.equal(testResult.ok, true);

  const implementResult = await hooks.onImplement(fakeWorkspace);
  assert.equal(implementResult.ok, true);

  const reviewResult = await hooks.onReview(
    fakeWorkspace,
    "sha256:" + "b".repeat(64),
  );
  assert.equal(reviewResult.ok, true);
  assert.deepEqual(
    stages.map((event) => `${event.stage}:${event.status}`),
    [
      "planner/planning:started",
      "planner/planning:completed",
      "qa/test_authoring:started",
      "qa/test_authoring:completed",
      "developer/implementation:started",
      "developer/implementation:completed",
      "qa/final:started",
      "qa/final:completed",
    ],
  );
  assert.equal(
    stages.every((event) => event.durationMs >= 0),
    true,
  );
});

void test("createRunnerOrchestrationHooks fails when runner execution fails", async () => {
  const adapter = createFakeRunnerAdapter({
    shouldFail: true,
    failureMessage: "Syntax error in draft",
  });
  const hooks = createRunnerOrchestrationHooks({
    ...defaultOptions,
    adapter,
  });

  assert.ok(hooks.onImplement);
  const result = await hooks.onImplement(fakeWorkspace);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CHECK_FAILED");
    assert.equal(result.error.message, "Syntax error in draft");
  }
});

void test("createRunnerOrchestrationHooks fails when runner adapter errors", async () => {
  const failingAdapter = {
    discover: () =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: "CAPABILITY_MISSING" as const,
          message: "Runner unavailable",
          retryable: false,
          remediation: "Check runner installation",
        },
      }),
    invoke: () =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: "CANCELLED" as const,
          message: "Runner was cancelled",
          retryable: false,
          remediation: "Retry invocation",
        },
      }),
    cancel: () =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: "CANCELLED" as const,
          message: "Cancel failed",
          retryable: false,
          remediation: "Check process",
        },
      }),
  };

  const hooks = createRunnerOrchestrationHooks({
    ...defaultOptions,
    adapter: failingAdapter,
  });

  assert.ok(hooks.onPlan);
  const result = await hooks.onPlan(fakeWorkspace);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CANCELLED");
  }
});
