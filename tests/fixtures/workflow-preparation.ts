// Synthetic evidence only; this is not a production prerequisite verifier.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { readBaselineTree } from "../../src/infrastructure/validation/qa-overlay.js";
import {
  readSourceRepositoryInfo,
  writeDraftTree,
} from "../../src/infrastructure/git/operations.js";
import type { WorkflowVerification } from "../../src/application/session-init.js";
import { workspaceMetaSchema } from "../../src/infrastructure/workspace/manager.js";
import type { WorkspacePaths } from "../../src/infrastructure/workspace/manager.js";
import type { TestPreparationEvaluation } from "../../src/application/evaluate-test-preparation.js";
import { fakeBallotFixture, passingCheck } from "./evidence.js";
import { preparationInput } from "./test-preparation.js";
import { hash } from "./validation.js";

export async function fakeWorkflowPreparation(
  workspace: WorkspacePaths,
  identity: WorkflowVerification["identity"],
): Promise<TestPreparationEvaluation> {
  const sessionId = workspaceMetaSchema.parse(
    JSON.parse(await readFile(workspace.metaFile, "utf8")),
  ).session_id;
  const source = await readSourceRepositoryInfo(workspace.draftDir);
  assert.ok(source.ok);
  const baseline = await readBaselineTree({
    repository: workspace.draftDir,
    baseCommit: {
      format: source.value.objectFormat,
      oid: source.value.headSha,
    },
  });
  assert.ok(baseline.ok);
  const current = await writeDraftTree(workspace.draftDir);
  assert.ok(current.ok);
  const config = repositoryConfigSchema.parse(
    JSON.parse(await readFile("tests/fixtures/config.json", "utf8")),
  );
  config.commands = [
    {
      check_id: "unit",
      kind: "test",
      executable: "node",
      args: ["FAKE"],
      report_format: "quorum-json-v1",
    },
  ];
  const input = preparationInput({
    config,
    sessionId: sessionId,
    baselineTree: baseline.value,
    redTree: { ...baseline.value, oid: current.value.treeOid },
    changeKind: "refactor",
  });
  const store = fakeBallotFixture();
  const checks = [input.baseline, input.expectedRed].map((snapshot) => {
    const record = {
      ...passingCheck(),
      check_result_id: `FAKE-${snapshot.identity.phase}`,
      session_id: sessionId,
      check_id: "unit",
      input: {
        phase: snapshot.identity.phase,
        input_digest: snapshot.input_digest,
      },
      command_digest: hash(config.commands[0]),
      environment_digest: snapshot.identity.environment_digest,
    };
    return {
      phase: snapshot.identity.phase,
      check_id: "unit",
      ref: store.put(`FAKE-${snapshot.identity.phase}`, record),
    };
  });
  identity.plan_digest = input.baseline.identity.motion_digest;
  identity.acceptance_digest = input.baseline.identity.specification_digest;
  identity.tests_digest = input.expectedRed.input_digest;
  identity.configuration_digest = input.baseline.identity.configuration_digest;
  identity.validation_environment_digest =
    input.baseline.identity.environment_digest;
  return {
    ...input,
    ports: store.ports,
    receipt: {
      schema_version: "1.0.0",
      session_id: sessionId,
      motion_digest: identity.plan_digest,
      specification_digest: identity.acceptance_digest,
      baseline_input_digest: input.baseline.input_digest,
      expected_red_input_digest: input.expectedRed.input_digest,
      checks,
    },
  };
}
