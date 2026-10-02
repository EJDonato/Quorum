import type { WorkflowContext } from "./session-init.js";
import { failure } from "../contracts/errors.js";
import { validatePreparationInput } from "./test-preparation-input.js";
import { evaluateTestPreparation } from "./evaluate-test-preparation.js";
import {
  verifyQaOverlay,
  readBaselineTree,
} from "../infrastructure/validation/qa-overlay.js";
import { writeArtifact } from "../infrastructure/storage/artifacts.js";
import { writeDraftTree } from "../infrastructure/git/operations.js";

export async function verifyWorkflowTestPreparation(ctx: WorkflowContext) {
  const verification = ctx.options.verification;
  if (!verification?.testPreparation)
    return failure(
      "CAPABILITY_MISSING",
      "Missing host test-preparation evidence loader.",
    );
  const loaded = await verification.testPreparation(ctx.workspace);
  if (!loaded.ok) return loaded;
  const input = loaded.value;
  const prepared = validatePreparationInput(input, ctx.ports);
  if (!prepared.ok) return prepared;
  const p = prepared.value;
  const current = await verifyCurrentQaDraft(
    ctx.workspace.draftDir,
    p.expectedRed.identity.tree.oid,
  );
  if (!current.ok) return current;
  const identity = verification.identity;
  const base = await readBaselineTree({
    repository: ctx.workspace.draftDir,
    baseCommit: { format: ctx.options.objectFormat, oid: ctx.options.baseSha },
  });
  if (!base.ok) return base;
  if (
    input.policy.sessionId !== ctx.options.sessionId ||
    p.baseline.identity.tree.oid !== base.value.oid ||
    p.baseline.identity.tree.format !== base.value.format ||
    p.motionDigest !== identity.plan_digest ||
    p.specificationDigest !== identity.acceptance_digest ||
    p.expectedRed.input_digest !== identity.tests_digest ||
    p.baseline.identity.configuration_digest !==
      identity.configuration_digest ||
    p.baseline.identity.environment_digest !==
      identity.validation_environment_digest
  )
    return failure(
      "STALE_INPUT",
      "Test preparation differs from the workflow's frozen inputs.",
    );
  const overlay = await verifyQaOverlay({
    repository: ctx.workspace.draftDir,
    baseline: p.baseline,
    expectedRed: p.expectedRed,
    testPaths: input.policy.testPaths,
  });
  if (!overlay.ok) return overlay;
  const checked = await evaluateTestPreparation({
    ...input,
    ports: { ...input.ports, digest: ctx.ports.digest },
  });
  if (!checked.ok) return checked;
  const stored = await writeArtifact({
    baseDir: ctx.sessionDir,
    relativePath: "test-preparation.json",
    content: JSON.stringify(input.receipt, null, 2) + "\n",
  });
  return stored.ok ? { ok: true as const, value: undefined } : stored;
}

async function verifyCurrentQaDraft(draftDir: string, expectedTreeOid: string) {
  const current = await writeDraftTree(draftDir);
  if (!current.ok) return current;
  return current.value.treeOid === expectedTreeOid
    ? { ok: true as const, value: undefined }
    : failure("STALE_INPUT", "QA draft changed after preparation validation.");
}
