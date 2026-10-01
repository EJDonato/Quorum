import assert from "node:assert/strict";
import test from "node:test";
import {
  isProcessAlive,
  probeProcessGroupCancellation,
  probeDetachedDescendantEscape,
  runCancellationProbeSuite,
} from "../probes/cancellation.js";

await test("isProcessAlive accurately identifies current process and invalid PIDs", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999_999_999), false);
});

await test("process group cancellation terminates both parent and in-group child processes", async () => {
  const result = await probeProcessGroupCancellation();
  assert.equal(result.parentTerminated, true);
  assert.equal(result.childTerminated, true);
  assert.equal(result.allTerminated, true);
});

await test("detached process escapes plain process group kill but is cleanly cleaned up", async () => {
  const result = await probeDetachedDescendantEscape();
  assert.equal(result.parentTerminated, true);
  assert.equal(result.detachedSurvivedProcessGroup, true);
  assert.equal(result.cleanupSuccessful, true);
});

await test("cancellation probe suite produces valid structured report and confirms container requirement", async () => {
  const report = await runCancellationProbeSuite();
  assert.equal(report.schema_version, "1.0.0");
  assert.equal(report.kind, "descendant_cancellation_probe");
  assert.equal(report.process_group_cleanup_effective, true);
  assert.equal(report.detached_escape_observed, true);
  assert.equal(report.container_boundary_required, true);
});
