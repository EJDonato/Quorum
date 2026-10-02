import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgyRunnerAdapter } from "../../src/infrastructure/adapters/agy/adapter.js";
import { createCodexRunnerAdapter } from "../../src/infrastructure/adapters/codex/adapter.js";
import { createRunnerAdapter } from "../../src/infrastructure/adapters/factory.js";
import type { InvocationRequest } from "../../src/contracts/invocation.js";
import type { WorkspacePaths } from "../../src/infrastructure/workspace/manager.js";

function makeFakeRequest(): InvocationRequest {
  return {
    protocol_version: "1.0.0",
    invocation_id: "inv-unit-test-1",
    session_id: "sess-unit-test-1",
    task_id: null,
    assignment: { role: "planner", phase: "planning" },
    input_digest: "sha256:" + "0".repeat(64),
    input_refs: [
      { artifact_id: "schema-1", digest: "sha256:" + "0".repeat(64) },
    ],
    grants: {
      tools: ["repo.read", "role.submit"],
      read_paths: ["*"],
      write_paths: [],
      check_ids: [],
    },
    response_schema_ref: {
      artifact_id: "schema-1",
      digest: "sha256:" + "0".repeat(64),
    },
    limits: { timeout_ms: 10_000, tokens_reserved: 5_000 },
  };
}

await test("createAgyRunnerAdapter discovers capabilities and validates expected version", async () => {
  const adapter = createAgyRunnerAdapter({
    expectedVersion: "1.2.14",
    model: "gemini-2.5-pro",
  });
  const controller = new AbortController();
  const caps = await adapter.discover(controller.signal);
  assert.equal(caps.ok, true);
  if (!caps.ok) return;
  assert.equal(caps.value.runnerName, "agy");
  assert.equal(caps.value.runnerVersion, "1.2.14");
  assert.equal(caps.value.modelVersion, "gemini-2.5-pro");
  assert.equal(caps.value.brokerOnlyTools, true);
  assert.equal(caps.value.isolationProfile, "linux-container-v1");
});

await test("createAgyRunnerAdapter invokes, installs tool-gate hooks and cancels cleanly", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "quorum-agy-test-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));

  const draftDir = join(tmp, "draft");
  const metaDir = join(tmp, "meta");
  const workspace: WorkspacePaths = {
    workspaceDir: tmp,
    draftDir,
    metaDir,
    metaFile: join(metaDir, "workspace.json"),
  };

  const adapter = createAgyRunnerAdapter({
    expectedVersion: "1.2.14",
  });

  const request = makeFakeRequest();
  const controller = new AbortController();

  const invokeResult = await adapter.invoke(
    request,
    controller.signal,
    workspace,
  );
  assert.equal(invokeResult.ok, true);
  if (!invokeResult.ok) return;

  assert.equal(invokeResult.value.execution_status, "SUCCEEDED");
  assert.equal(invokeResult.value.invocation_id, request.invocation_id);
  assert.equal(invokeResult.value.session_id, request.session_id);

  const hooksContent = await readFile(
    join(workspace.workspaceDir, ".agents", "hooks.json"),
    "utf-8",
  );
  assert.match(hooksContent, /quorum-broker-gate/);

  const cancelResult = await adapter.cancel(request.invocation_id);
  assert.equal(cancelResult.ok, true);
  if (!cancelResult.ok) return;
  assert.equal(cancelResult.value.invocationId, request.invocation_id);
  assert.equal(cancelResult.value.confirmedAbsent, true);
});

await test("createCodexRunnerAdapter discovers capabilities and invokes correctly", async () => {
  const adapter = createCodexRunnerAdapter({
    expectedVersion: "0.159.3",
    model: "codex-1",
  });
  const controller = new AbortController();
  const caps = await adapter.discover(controller.signal);
  assert.equal(caps.ok, true);
  if (!caps.ok) return;
  assert.equal(caps.value.runnerName, "codex");
  assert.equal(caps.value.runnerVersion, "0.159.3");
  assert.equal(caps.value.modelVersion, "codex-1");

  const request = makeFakeRequest();
  const invokeResult = await adapter.invoke(request, controller.signal);
  assert.equal(invokeResult.ok, true);
  if (!invokeResult.ok) return;
  assert.equal(invokeResult.value.execution_status, "SUCCEEDED");

  const cancelResult = await adapter.cancel(request.invocation_id);
  assert.equal(cancelResult.ok, true);
});

await test("createRunnerAdapter factory selects configured adapter", () => {
  const agy = createRunnerAdapter("agy");
  assert.ok(agy);
  const codex = createRunnerAdapter("codex");
  assert.ok(codex);
});
